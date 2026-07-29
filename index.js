const express = require("express");
require("dotenv").config();
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const Stripe = require("stripe");

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
    app.get("/books", async (req, res) => {
      const { librarianId } = req.query;

      try {
        const query = librarianId ? { librarianId } : { status: "Published" };
        const books = await booksCollection.find(query).toArray();

        res.send(books);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch books." });
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
    app.get("/admin/users", async (req, res) => {
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
          success_url: `${CLIENT_URL}/books/${bookId}?success=true`,
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
        const { bookId, userId } = session.metadata || {};

        try {
          if (!bookId || !ObjectId.isValid(bookId)) {
            console.error("Webhook: missing or invalid bookId in metadata.");
            return res.status(200).send({ received: true });
          }

          const book = await booksCollection.findOne({
            _id: new ObjectId(bookId),
          });

          if (!book) {
            console.error("Webhook: book not found for id", bookId);
            return res.status(200).send({ received: true });
          }

          let clientName = "Unknown";
          if (userId) {
            const user =
              (await usersCollection.findOne({ _id: userId })) ||
              (ObjectId.isValid(userId)
                ? await usersCollection.findOne({ _id: new ObjectId(userId) })
                : null);
            if (user?.name) clientName = user.name;
          }

          await deliveriesCollection.insertOne({
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
          });

          await booksCollection.updateOne(
            { _id: new ObjectId(bookId) },
            { $set: { status: "Pending Delivery", available: false } },
          );
        } catch (error) {
          console.error("Webhook processing error:", error);
          // Still acknowledge receipt so Stripe doesn't retry indefinitely
          // for an error that isn't Stripe's problem to fix.
        }
      }

      res.status(200).send({ received: true });
    });
    console.log("MongoDB Connected");
  } catch (error) {
    console.error(error);
  }
}

run().catch(console.dir);

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
