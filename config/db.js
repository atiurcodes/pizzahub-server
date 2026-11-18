import { MongoClient } from "mongodb"

let client
let db

// Connect once to MongoDB and reuse the connection across all Express routes
export async function connectDB() {
  if (db) return db

  const mongoUri = process.env.MONGODB_URI
  if (!mongoUri) {
    throw new Error("Please add MONGODB_URI to pizzahub-server/.env")
  }

  client = new MongoClient(mongoUri)
  await client.connect()
  db = client.db("pizzahubdb")

  console.log("Connected to MongoDB")
  return db
}

export function getDB() {
  if (!db) {
    throw new Error("Database not initialized. Call connectDB() first.")
  }
  return db
}
