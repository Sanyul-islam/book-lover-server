# Book Lover — Backend Server

Express + MongoDB (native driver) API powering the Book Lover platform: browsing and managing books, delivery requests via Stripe, reviews, and role-based dashboards for readers, librarians, and admins.

> Route-level auth is enforced via JWT verification against `better-auth`'s JWKS endpoint — see [Authentication](#authentication) below for how it works and which routes it currently protects.

## Tech Stack

- **Express** — REST API
- **MongoDB** (native `mongodb` driver, no ODM) — data storage
- **Stripe** — delivery-fee checkout + webhook-confirmed payments
- **CORS** — cross-origin requests from the Next.js frontend
- **jose** — JWT verification via remote JWKS (see [Authentication](#authentication))

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a `.env` file in the project root:

```env
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/?retryWrites=true&w=majority
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
CLIENT_URL=http://localhost:3000
```

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | Yes | Connection string for your MongoDB cluster/instance |
| `STRIPE_SECRET_KEY` | Yes | Stripe secret key, used to create Checkout Sessions |
| `STRIPE_WEBHOOK_SECRET` | Yes | Signing secret for verifying Stripe webhook events (see below) |
| `CLIENT_URL` | Yes | Frontend origin. Used to build Stripe `success_url`/`cancel_url`, **and** as the source of the JWKS endpoint (`${CLIENT_URL}/api/auth/jwks`) for JWT verification |

> **Note:** `CLIENT_URL` falls back to `http://localhost:3000` for Stripe redirects if unset, but the JWT middleware's JWKS URL has no such fallback — if `CLIENT_URL` is missing, JWT verification will fail to initialize even though Stripe checkout would still silently work. Treat this variable as required.

The server runs on **port 8000** (hardcoded).

### 3. Run the server

```bash
node server.js
```

On success you should see:

```
MongoDB Connected
Server is running at http://localhost:8000
```

### 4. Forward Stripe webhooks locally

Stripe can't reach `localhost` directly, so use the Stripe CLI during development:

```bash
stripe listen --forward-to localhost:8000/webhook/stripe
```

The first time you run this, it prints a `whsec_...` value — put that in `.env` as `STRIPE_WEBHOOK_SECRET`. In production, register the webhook endpoint in the Stripe Dashboard instead and use the signing secret it provides there.

> **Note:** as a fallback for local development where the webhook may not be running, `POST /verify-checkout-session` performs the same fulfillment logic and is called by the frontend when a user lands back on a book's page after checkout. The webhook remains the source of truth in production — never trust a client-side redirect alone to confirm payment.

## Database

Database name: `book-lover`

| Collection | Purpose |
|---|---|
| `user` | User accounts (managed by the auth layer) — `_id`, `name`, `email`, `role` (`user` / `librarian` / `admin`), `image` |
| `books` | Book listings — includes `status` (`Pending Approval` / `Published` / `Unpublished` / `Pending Delivery` / `Checked Out`), `librarianId`, `category`, `deliveryFee`, `image`, etc. |
| `reviews` | Book reviews — `bookId`, `userId`, `rating`, `comment`, `createdAt` |
| `deliveries` | Delivery/transaction records — created **only** on confirmed Stripe payment (via the webhook or the verify fallback), never client-side |

## API Reference

All responses are JSON. Errors return `{ "message": "..." }` with an appropriate status code.

### Health Check

| Method | Route | Description |
|---|---|---|
| `GET` | `/` | Basic server health check |

### Books

| Method | Route | Description |
|---|---|---|
| `GET` | `/books` | Public: only `Published` books. Add `?librarianId=<id>` for a librarian's own listings (any status). Add `?admin=true` for every book platform-wide (admin only). |
| `GET` | `/books/:id` | Get a single book by id |
| `POST` | `/books` | Create a new book listing. Always forced to `status: "Pending Approval"` server-side, regardless of what's sent |
| `PATCH` | `/books/:id` | Update a book (editing, approval, publish/unpublish toggles) |
| `DELETE` | `/books/:id` | Delete a book |

### Reviews

| Method | Route | Description |
|---|---|---|
| `GET` | `/books/:id/reviews` | Get all reviews for a book |
| `POST` | `/books/:id/reviews` | Submit a review. **Requires** the user to have a delivery record for that book (i.e. actually purchased it) — returns `403` otherwise |
| `GET` | `/reviews?userId=<id>` | Get all reviews left by a specific user |
| `PATCH` | `/reviews/:id` | Edit a review's `rating`/`comment` |
| `DELETE` | `/reviews/:id` | Delete a review |

### Deliveries

| Method | Route | Description |
|---|---|---|
| `GET` | `/deliveries?userId=<id>` | A user's own delivery history |
| `GET` | `/deliveries?librarianId=<id>` | Delivery requests for a librarian's books |
| `GET` | `/deliveries/check?userId=<id>&bookId=<id>` | Returns `{ purchased: boolean }` — whether this user has a delivery record for this book |
| `PATCH` | `/deliveries/:id` | Update delivery status (`Pending` → `Dispatched` → `Delivered`) |

### Checkout & Payments

| Method | Route | Description |
|---|---|---|
| `POST` | `/create-checkout-session` | Creates a Stripe Checkout Session for a book's delivery fee. Body: `{ bookId, userId, deliveryFee }` |
| `POST` | `/webhook/stripe` | Stripe webhook — on `checkout.session.completed`, creates the delivery record and sets the book to `Pending Delivery`. **Never call this manually**; Stripe signs and sends it |
| `POST` | `/verify-checkout-session` | Local-dev fallback that performs the same fulfillment as the webhook, called by the frontend on return from Stripe |

### Admin

| Method | Route | Description |
|---|---|---|
| `GET` | `/admin/users` | All users, with sensitive auth fields stripped out |
| `PATCH` | `/users/:id` | Change a user's role (`user` / `librarian` / `admin`) |
| `DELETE` | `/users/:id` | Delete a user |
| `GET` | `/admin/transactions` | All delivery records enriched with `userEmail` / `librarianEmail`, for the platform-wide transactions table |

## Authentication

Protected routes are guarded by a `verifyToken` middleware that validates JWTs issued by the frontend's `better-auth` instance — **not** a shared secret. Verification works via a remote JWKS (JSON Web Key Set):

```javascript
const JWKS = createRemoteJWKSet(new URL(`${process.env.CLIENT_URL}/api/auth/jwks`));

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  try {
    const { payload } = await jwtVerify(token, JWKS);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
};
```

**How it works:**
1. The client sends `Authorization: Bearer <token>` on protected requests.
2. The middleware fetches (and caches) `better-auth`'s public keys from `${CLIENT_URL}/api/auth/jwks`.
3. `jwtVerify` checks the token's signature and expiry against those keys.
4. On success, the decoded claims are attached to `req.user`, available to any route handler after this middleware.
5. On failure: `401` with `"Unauthorized"` (missing/malformed header) or `"Invalid or expired token."` (verification failed).

**Protected routes:** _TODO — fill in once confirmed._ `verifyToken` is defined but this README doesn't yet know which routes have it applied. Update this list to match reality:

| Method | Route | Protected? |
|---|---|---|
| `POST` | `/books` | ⬜ |
| `PATCH` | `/books/:id` | ⬜ |
| `DELETE` | `/books/:id` | ⬜ |
| `PATCH` | `/deliveries/:id` | ⬜ |
| `GET` | `/admin/users` | ⬜ |
| `PATCH` | `/users/:id` | ⬜ |
| `DELETE` | `/users/:id` | ⬜ |
| `GET` | `/admin/transactions` | ⬜ |

> ⚠️ Note this table currently makes no promises — until it's filled in, assume routes are **unprotected** rather than risk documentation claiming security that isn't actually there.

**Role checks:** `verifyToken` confirms *who* the caller is (a valid, non-expired token), but the code above doesn't check *what role* they have. If `/admin/*` routes rely on `req.user.role`, confirm that check is actually applied per-route (either inside `verifyToken` itself or as a separate middleware) — a valid token alone isn't sufficient to authorize an admin-only action.