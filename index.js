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
app.use(express.json());

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
