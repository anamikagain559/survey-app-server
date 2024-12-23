const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const port = process.env.PORT || 5000;
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
// middleware
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  })
);
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.vy8vv76.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
};
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    //await client.connect();

    const userCollection = client.db("surveyDB").collection("users");
    const taskCollection = client.db("surveyDB").collection("tasks");
    const taskActivityCollection = client.db("surveyDB").collection("taskActivity");
    // jwt related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // middlewares
    const verifyToken = (req, res, next) => {
      // console.log('inside verify token', req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    // use verify admin after verifyToken
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };


    // users related api
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.get("/users/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === "admin";
      }
      res.send({ admin });
    });

    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;

      // if (email !== req.decoded.email) {
      //   return res.status(403).send({ message: "forbidden access" });
      // }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      let role = false;
      if (user?.role === "admin") {
        role = "admin";
      } else if (user?.role === "surveyor") {
        role = "surveyor";
      } else if (user?.role === "pro-user") {
        role = "pro-user";
      } else if (user?.role === "user") {
        role = "user";
      }
      res.send({ role });
    });

    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.send(user);
    });

    // Create a new user with a default role of "user"
    app.post("/users", async (req, res) => {
      const user = req.body;

      // Insert email if user doesn't exist
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exists", insertedId: null });
      }

      // Add default role "user"
     // user.role = "user";

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.patch("/users/role/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const role = req.body.role;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: role,
        },
      };
      const result = await userCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.patch("/user/role/:email", async (req, res) => {
      const { email } = req.params;
      const { role } = req.body;

      const updatedUser = await userCollection.updateOne(
        { email },
        { $set: { role } }
      );
      res.send(updatedUser);
    });

    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });



    // Route to get a survey by ID
    app.get("/tasks/:id", async (req, res) => {
      const id = req.params.id;

      try {
        // Validate the ID
        if (!ObjectId.isValid(id)) {
          return res.status(400).send("Invalid survey ID");
        }

        const query = { _id: new ObjectId(id) };
        const result = await taskCollection.findOne(query);

        if (!result) {
          return res.status(404).send("Survey not found");
        }

        res.json(result);
      } catch (error) {
        console.error("Error fetching survey:", error);
        res.status(500).send("Error fetching survey");
      }
    });


    app.post("/tasks/activities/:id", async (req, res) => {
      const taskId = req.params.id;
      const { activity } = req.body;
      const timestamp = new Date();
    
      try {
        // Create the activity object with task_id and activity details
        const newActivity = {
          task_id: taskId, // Adding the task_id to the activity
          name: activity,
          createdAt: timestamp
        };
    
        // Push the new activity to the task's activities array
        const result = await taskActivityCollection.insertOne(newActivity)
    
        // If no task is found or updated
   
        // Return success response with the added activity
        res.status(200).json({ message: "Activity added successfully" });
      } catch (error) {
        console.error("Error adding activity:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    app.get("/tasks/:taskId/activities", async (req, res) => {
      const task_id = req.params.taskId;
       console.log(task_id);
      const query = { task_id: new ObjectId(task_id) };
        const activities = await taskActivityCollection.find({}).toArray();         // Convert the cursor to an array
    
  
        res.json(activities);
  
    });

    app.put("/tasks/:taskId", async (req, res) => {
      try {
        const taskId = req.params.taskId;
        const filter = { _id: new ObjectId(taskId) };
        const options = { upsert: true };
        const updatedSurveyCollection = req.body;

        const survey = {
          $set: {
            title: updatedSurveyCollection.title,
            description: updatedSurveyCollection.description,
            priority: updatedSurveyCollection.priority,
            status: updatedSurveyCollection.status,
            dueDate: updatedSurveyCollection.dueDate,
          },
        };

        const result = await taskCollection.updateOne(
          filter,
          survey,
          options
        );
        res.send(result);
      } catch (error) {
        console.error("Error updating Survey:", error);
        res
          .status(500)
          .json({ error: "An error occurred while updating Survey" });
      }
    });


    app.put("/tasks/activities/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const options = { upsert: true };
        const updatedTaskActivityCollection = req.body;
        const activity = {
          $set: {
            name: updatedTaskActivityCollection.activity,
         
          },
        };

        const result = await taskActivityCollection.updateOne(
          filter,
          activity,
          options
        );
        res.send(result);
      } catch (error) {
        console.error("Error updating Survey:", error);
        res
          .status(500)
          .json({ error: "An error occurred while updating Survey" });
      }
    });

   
    // Route to get surveys by user email
    app.get("/tasks/:email", async (req, res) => {

      const { email } = req.params;
      if (!email) {
        return res.status(400).send({ error: "Email is required" });
      }
      try {
        const result = await taskCollection.find({ userEmail: email }).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch tasks" });
      }
    });

    app.get("/tasks", async (req, res) => {
      try {
        const result = await taskCollection.find().toArray(); // Fetch all tasks without filtering
        res.send(result);
      } catch (error) {
        console.error("Error fetching tasks:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.delete('/tasks/:id', async (req, res) => {
     
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await taskCollection.deleteOne(query);
        res.send(result);
    });
    app.delete('/tasks/activities/:activityId', async (req, res) => {
     
      const activityId = req.params.activityId;
      const query = { _id: new ObjectId(activityId) };
      const result = await taskActivityCollection.deleteOne(query);
      res.send(result);
  });
  



    app.post("/tasks",verifyToken, async (req, res) => {
      try {
        const surveyData = {
          ...req.body,
          timestamp: new Date(),
        };
        const result = await taskCollection.insertOne(surveyData);
        res.send(result);
      } catch (error) {
        console.error("Error inserting survey", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });


    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("App is Running");
});

app.listen(port, () => {
  console.log(`Survey app is Running on port ${port}`);
});

/**
 * --------------------------------
 *      NAMING CONVENTION
 * --------------------------------
 * app.get('/users')
 * app.get('/users/:id')
 * app.post('/users')
 * app.put('/users/:id')
 * app.patch('/users/:id')
 * app.delete('/users/:id')
 *
 */
