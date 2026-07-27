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
