const express = require("express");
require("dotenv").config();
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const Stripe = require("stripe");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");

const app = express();
const PORT = 8000;

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

// Middleware
app.use(cors());
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  }),
);

const JWKS = createRemoteJWKSet(new URL(`${process.env.CLIENT_URL}/api/auth/jwks`));
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1];
  if(!token){
    return res.status(401).json({ message: "Unauthorized" });
  }
  try{
    const { payload } = await jwtVerify(token, JWKS)
    req.user = payload;
    
    next();
  }
  catch (err) {
    return res.status(401).json({ message: "Invalid or expired token." });
  }  
}
// MongoDB Connection
const uri = process.env.MONGODB_URI; // Your MongoDB connection string
const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect();

    const db = client.db("book-lover");
    const usersCollection = db.collection("user");
    const booksCollection = db.collection("books");
    const reviewsCollection = db.collection("reviews");
    const deliveriesCollection = db.collection("deliveries");

    // Home Route
    app.get("/", (req, res) => {
      res.send("Hello, your Express server is working perfectly!");
    });

    // Get all books
    app.get("/books", async (req, res) => {
      try {
        const books = await booksCollection.find().toArray();

        res.send(books);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch books." });
      }
    });
    // Get a single book by id
    app.get("/books/:id", async (req, res) => {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid book id." });
      }

      try {
        const book = await booksCollection.findOne({ _id: new ObjectId(id) });

        if (!book) {
          return res.status(404).send({ message: "Book not found." });
        }

        res.send(book);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch book." });
      }
    });
    // Get all books (optionally filtered to a specific librarian's own listings).
    // Public requests (no librarianId) only see Published books.
    app.get("/librarian/books", async (req, res) => {
      try {
        const { librarianId } = req.query;

        if (!librarianId) {
          return res.status(400).send({
            message: "librarianId is required",
          });
        }

        const books = await booksCollection.find({ librarianId }).toArray();

        res.send(books);
      } catch (error) {
        console.error(error);
        res.status(500).send({
          message: "Failed to fetch books.",
        });
      }
    });
    // Add a new book (librarian submission — always starts as Pending Approval)
    app.post("/books", async (req, res) => {
      const {
        title,
        author,
        description,
        deliveryFee,
        category,
        image,
        librarianId,
      } = req.body;

      if (
        !title ||
        !author ||
        !description ||
        !deliveryFee ||
        !image ||
        !librarianId
      ) {
        return res.status(400).send({ message: "Missing required fields." });
      }

      try {
        const newBook = {
          ...req.body,
          status: "Pending Approval",
          available: false,
          createdAt: new Date(),
        };

        const result = await booksCollection.insertOne(newBook);
        res
          .status(201)
          .send({ message: "Book submitted for approval.", result });
      } catch (error) {
        res.status(500).send({ message: "Failed to add book." });
      }
    });
    // Update a book (used for editing, and for unpublish/status changes)
    app.patch("/books/:id", async (req, res) => {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid book id." });
      }

      try {
        const result = await booksCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: req.body },
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Book not found." });
        }

        res.send({ message: "Book updated.", result });
      } catch (error) {
        res.status(500).send({ message: "Failed to update book." });
      }
    });
    // Delete a book
    app.delete("/books/:id", async (req, res) => {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid book id." });
      }

      try {
        const result = await booksCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Book not found." });
        }

        res.send({ message: "Book deleted." });
      } catch (error) {
        res.status(500).send({ message: "Failed to delete book." });
      }
    });
    //////////////BOOK REVIEWS////////////////////
    //Get User reviews by Id
    app.get("/reviews", async (req, res) => {
      const { userId } = req.query;

      try {
        const query = userId ? { userId } : {};

        const reviews = await reviewsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        res.send(reviews);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch reviews." });
      }
    });

    // Get reviews for a book
    app.get("/books/:id/reviews", async (req, res) => {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid book id." });
      }

      try {
        const reviews = await reviewsCollection
          .find({ bookId: id })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(reviews);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch reviews." });
      }
    });

    // Create a review for a book
    app.post("/books/:id/reviews", async (req, res) => {
      const { id } = req.params;
      const { userId, userName, userImage, rating, comment } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid book id." });
      }

      if (!userId || !rating || !comment) {
        return res
          .status(400)
          .send({ message: "userId, rating, and comment are required." });
      }

      try {
        const purchased = await hasPurchased(userId, id);
        if (!purchased) {
          return res.status(403).send({
            message: "You can only review books you've purchased.",
          });
        }

        const review = {
          bookId: id,
          userId,
          userName: userName || "Anonymous Reader",
          userImage: userImage || null,
          rating: Number(rating),
          comment,
          createdAt: new Date(),
        };

        const result = await reviewsCollection.insertOne(review);
        res.status(201).send({
          message: "Review submitted.",
          review: { ...review, _id: result.insertedId },
        });
      } catch (error) {
        res.status(500).send({ message: "Failed to submit review." });
      }
    });

    // Update a review (edit rating/comment)
    app.patch("/reviews/:id", async (req, res) => {
      const { id } = req.params;
      const { rating, comment } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid review id." });
      }

      try {
        const result = await reviewsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { rating, comment, updatedAt: new Date() } },
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Review not found." });
        }

        res.send({ message: "Review updated." });
      } catch (error) {
        res.status(500).send({ message: "Failed to update review." });
      }
    });

    // Delete a review
    app.delete("/reviews/:id", async (req, res) => {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid review id." });
      }

      try {
        const result = await reviewsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Review not found." });
        }

        res.send({ message: "Review deleted." });
      } catch (error) {
        res.status(500).send({ message: "Failed to delete review." });
      }
    });
    
    // Get deliveries — filtered by userId (a client's own history) or librarianId (a librarian's incoming requests)
    app.get("/deliveries", async (req, res) => {
      const { userId, librarianId } = req.query;

      if (!userId && !librarianId) {
        return res
          .status(400)
          .send({ message: "userId or librarianId is required." });
      }

      try {
        const query = userId ? { userId } : { librarianId };
        const deliveries = await deliveriesCollection
          .find(query)
          .sort({ requestDate: -1 })
          .toArray();

        res.send(deliveries);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch deliveries." });
      }
    });

    // Update a delivery's status (librarian moves it Pending -> Dispatched -> Delivered)
    app.patch("/deliveries/:id", async (req, res) => {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid delivery id." });
      }

      try {
        const result = await deliveriesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { ...req.body, updatedAt: new Date() } },
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Delivery not found." });
        }

        res.send({ message: "Delivery updated." });
      } catch (error) {
        res.status(500).send({ message: "Failed to update delivery." });
      }
    });

    // Get all users (admin only) — strips sensitive auth fields before sending
    app.get("/admin/users",verifyToken, async (req, res ) => {
      try {
        const users = await usersCollection
          .find()
          .project({ password: 0, hashedPassword: 0, sessions: 0, accounts: 0 })
          .toArray();

        res.send(users);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch users." });
      }
    });
    // Change a user's role
    app.patch("/users/:id", async (req, res) => {
      const { id } = req.params;
      const { role } = req.body;

      if (!["user", "librarian", "admin"].includes(role)) {
        return res.status(400).send({ message: "Invalid role." });
      }

      try {
        const filter = ObjectId.isValid(id)
          ? { _id: new ObjectId(id) }
          : { _id: id };
        const result = await usersCollection.updateOne(filter, {
          $set: { role },
        });

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "User not found." });
        }

        res.send({ message: "Role updated." });
      } catch (error) {
        res.status(500).send({ message: "Failed to update role." });
      }
    });
    // Delete a user
    app.delete("/users/:id", async (req, res) => {
      const { id } = req.params;

      try {
        const filter = ObjectId.isValid(id)
          ? { _id: new ObjectId(id) }
          : { _id: id };
        const result = await usersCollection.deleteOne(filter);

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "User not found." });
        }

        res.send({ message: "User deleted." });
      } catch (error) {
        res.status(500).send({ message: "Failed to delete user." });
      }
    });

    // Get all transactions (admin only) — one row per delivery, enriched with emails
    app.get("/admin/transactions", verifyToken, async (req, res) => {
      try {
        const deliveries = await deliveriesCollection
          .find()
          .sort({ requestDate: -1 })
          .toArray();

        const transactions = await Promise.all(
          deliveries.map(async (d) => {
            const clientUser = await findUserById(d.userId);
            const librarianUser = await findUserById(d.librarianId);

            return {
              _id: d._id,
              transactionId: d.stripeSessionId || String(d._id),
              userEmail: clientUser?.email || "Unknown",
              librarianEmail: librarianUser?.email || "Unknown",
              amount: d.deliveryFee,
              date: d.requestDate,
            };
          }),
        );

        res.send(transactions);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch transactions." });
      }
    });

    // A user may only review a book they've actually paid for — any delivery
    // record for that userId+bookId pair means the Stripe payment succeeded
    // (delivery records only ever get created in fulfillCheckoutSession,
    // after Stripe confirms payment — see above).
    async function hasPurchased(userId, bookId) {
      if (!userId || !bookId) return false;
      const delivery = await deliveriesCollection.findOne({ userId, bookId });
      return !!delivery;
    }
    // Check whether the current user has purchased a given book (used by the
    // frontend to decide whether to show the review form)
    app.get("/deliveries/check", async (req, res) => {
      const { userId, bookId } = req.query;

      try {
        const purchased = await hasPurchased(userId, bookId);
        res.send({ purchased });
      } catch (error) {
        res.status(500).send({ message: "Failed to check purchase status." });
      }
    });

    // Resolves a user document whether _id is stored as a plain string
    // or a MongoDB ObjectId (varies by auth adapter config).
    async function findUserById(id) {
      if (!id) return null;
      const byString = await usersCollection.findOne({ _id: id });
      if (byString) return byString;
      if (ObjectId.isValid(id)) {
        return usersCollection.findOne({ _id: new ObjectId(id) });
      }
      return null;
    }

    // Creates the delivery record + flips the book to "Pending Delivery",
    // for a Stripe session that has been confirmed as paid.
    // Idempotent: safe to call twice for the same session (e.g. once from
    // the webhook, once from the frontend fallback) — the second call is a no-op.
    async function fulfillCheckoutSession(session) {
      const existing = await deliveriesCollection.findOne({
        stripeSessionId: session.id,
      });
      if (existing) return existing;

      const { bookId, userId } = session.metadata || {};

      if (!bookId || !ObjectId.isValid(bookId)) {
        console.error(
          "fulfillCheckoutSession: missing or invalid bookId in metadata.",
        );
        return null;
      }

      const book = await booksCollection.findOne({ _id: new ObjectId(bookId) });
      if (!book) {
        console.error("fulfillCheckoutSession: book not found for id", bookId);
        return null;
      }

      let clientName = "Unknown";
      if (userId) {
        const user = await findUserById(userId);
        if (user?.name) clientName = user.name;
      }

      const delivery = {
        bookId,
        userId,
        librarianId: book.librarianId,
        bookTitle: book.title,
        bookImage: book.image,
        clientName,
        deliveryFee: session.amount_total
          ? session.amount_total / 100
          : book.deliveryFee,
        requestDate: new Date(),
        status: "Pending",
        stripeSessionId: session.id,
      };

      await deliveriesCollection.insertOne(delivery);

      await booksCollection.updateOne(
        { _id: new ObjectId(bookId) },
        { $set: { status: "Pending Delivery", available: false } },
      );

      return delivery;
    }

    // Create a Stripe Checkout session for the delivery fee
    app.post("/create-checkout-session", async (req, res) => {
      const { bookId, userId, deliveryFee } = req.body;

      if (!bookId || !ObjectId.isValid(bookId)) {
        return res.status(400).send({ message: "Invalid book id." });
      }

      try {
        const book = await booksCollection.findOne({
          _id: new ObjectId(bookId),
        });

        if (!book) {
          return res.status(404).send({ message: "Book not found." });
        }

        if (
          book.status === "Checked Out" ||
          book.status === "Pending Delivery"
        ) {
          return res.status(400).send({
            message: "This book is not currently available for delivery.",
          });
        }

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: `Delivery fee - ${book.title}`,
                },
                unit_amount: Math.round(
                  (deliveryFee || book.deliveryFee) * 100,
                ),
              },
              quantity: 1,
            },
          ],
          metadata: {
            bookId,
            userId: userId || "",
          },
          success_url: `${CLIENT_URL}/books/${bookId}?success=true&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${CLIENT_URL}/books/${bookId}?canceled=true`,
        });

        res.send({ url: session.url });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to create checkout session." });
      }
    });

    // Stripe webhook — fires once payment is actually confirmed.
    // This is the ONLY place that should create a delivery record or
    // move a book to "Pending Delivery"; never trust the client redirect alone.
    app.post("/webhook/stripe", async (req, res) => {
      const sig = req.headers["stripe-signature"];
      let event;

      try {
        event = stripe.webhooks.constructEvent(
          req.rawBody,
          sig,
          process.env.STRIPE_WEBHOOK_SECRET,
        );
      } catch (error) {
        console.error("Webhook signature verification failed:", error.message);
        return res.status(400).send(`Webhook Error: ${error.message}`);
      }

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;

        try {
          await fulfillCheckoutSession(session);
        } catch (error) {
          console.error("Webhook processing error:", error);
          // Still acknowledge receipt so Stripe doesn't retry indefinitely
          // for an error that isn't Stripe's problem to fix.
        }
      }

      res.status(200).send({ received: true });
    });

    // Fallback for local dev / when the webhook hasn't fired yet: the frontend
    // calls this right after Stripe redirects back with ?session_id=..., so the
    // delivery gets created even without `stripe listen` running. Verifies
    // payment status directly with Stripe before doing anything — never trusts
    // the redirect alone. Safe to call even if the webhook already ran, since
    // fulfillCheckoutSession is idempotent.
    app.post("/verify-checkout-session", async (req, res) => {
      const { sessionId } = req.body;

      if (!sessionId) {
        return res.status(400).send({ message: "sessionId is required." });
      }

      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status !== "paid") {
          return res.status(400).send({ message: "Payment not completed." });
        }

        const delivery = await fulfillCheckoutSession(session);

        if (!delivery) {
          return res.status(500).send({
            message: "Payment confirmed but delivery could not be created.",
          });
        }

        res.send({ message: "Delivery confirmed.", delivery });
      } catch (error) {
        console.error("verify-checkout-session error:", error);
        res.status(500).send({ message: "Failed to verify checkout session." });
      }
    });

    console.log("MongoDB Connected");
  } catch (error) {
    console.error(error);
  }
}

run().catch(console.dir);
// module.exports = app;

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
