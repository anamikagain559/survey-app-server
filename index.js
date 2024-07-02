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
    origin: ["http://localhost:5173", "https://survey-app-f0656.web.app"],
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
    const surveyCollection = client.db("surveyDB").collection("surveys");
    const voteCollection = client.db("surveyDB").collection("votes");
    const paymentCollection = client.db("surveyDB").collection("payments");
    const reportCollection = client.db("surveyDB").collection("reports");
    const commentCollection = client.db("surveyDB").collection("comments");
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

    const verifySurveyor = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isSurveyor = user?.role === "surveyor";
      if (!isSurveyor) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    const verifyProUser = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isProUser = user?.role === "pro-user";
      if (!isProUser) {
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
      user.role = "user";

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

    // payment intent
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      console.log(amount, "amount inside the intent");

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.get("/payments/:email", verifyToken, verifyAdmin, async (req, res) => {
      console.log(req.decoded.email);
      const query = { email: req.params.email };
      if (req.params.email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const result = await paymentCollection.find().toArray();
      res.send(result);
    });
    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const paymentResult = await paymentCollection.insertOne(payment);

      //  console.log("payment info", payment);

      res.send({ paymentResult });
    });

    // backend/server.js
    app.get("/surveys", async (req, res) => {
      const { category, sort } = req.query;
      let filter = {};
      let sortOption = {};

      if (category) {
        filter.category = category;
      }

      if (sort === "votes") {
        sortOption.voteCount = -1; // Sort by vote count in descending order
      }

      try {
        const surveys = await surveyCollection
          .find(filter)
          .sort(sortOption)
          .toArray();
        res.status(200).send(surveys);
      } catch (error) {
        console.error("Error fetching surveys", error);
        res
          .status(500)
          .send({ message: "Internal Server Error", error: error.message });
      }
    });
    // Route to get a survey by ID
    app.get("/surveys/:id", async (req, res) => {
      const id = req.params.id;

      try {
        // Validate the ID
        if (!ObjectId.isValid(id)) {
          return res.status(400).send("Invalid survey ID");
        }

        const query = { _id: new ObjectId(id) };
        const result = await surveyCollection.findOne(query);

        if (!result) {
          return res.status(404).send("Survey not found");
        }

        res.json(result);
      } catch (error) {
        console.error("Error fetching survey:", error);
        res.status(500).send("Error fetching survey");
      }
    });

    app.put("/surveys/:surveyId",verifyToken,verifySurveyor, async (req, res) => {
      try {
        const surveyId = req.params.surveyId;

        // Verify token owner
        // if (email !== req.user.email) {
        //   return res.status(403).send({ message: "Forbidden access" });
        // }

        const filter = { _id: new ObjectId(surveyId) };
        const options = { upsert: true };
        const updatedSurveyCollection = req.body;

        const survey = {
          $set: {
            title: updatedSurveyCollection.title,
            description: updatedSurveyCollection.description,
            category: updatedSurveyCollection.category,
            options: updatedSurveyCollection.options,
            deadline: updatedSurveyCollection.deadline,
          },
        };

        const result = await surveyCollection.updateOne(
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

    // Report a survey
    app.post("/report/:surveyID", async (req, res) => {
      const { userEmail, title, category, description, reason } = req.body;
      const surveyId = req.params.surveyID;

      // Check if the report already exists for the user and survey
      const query = { surveyId, userEmail };
      const existingReport = await reportCollection.findOne(query);

      if (existingReport) {
        return res.status(200).json({ message: "You have already Reported" });
      }

      const newReport = {
        surveyId,
        userEmail,
        title,
        category,
        description,
        reason,
      };
      const result = await reportCollection.insertOne(newReport);
      res.send(result);
    });

    // Fetch all reports by user email
    app.get("/user/reports/:userEmail", async (req, res) => {
      const { userEmail } = req.params;

      try {
        // Find all reports by the user using userEmail
        const reports = await reportCollection.find({ userEmail }).toArray();

        res.status(200).json(reports);
      } catch (error) {
        res.status(500).json({ message: "Error fetching reports", error });
      }
    });

    // Comment a survey
    app.post("/comment/:surveyID", async (req, res) => {
      const {
        userEmail,
        title,
        category,
        description,
        text,
        userProfilePicture,
        userName,
      } = req.body;
      const surveyId = req.params.surveyID;

      try {
        // Ensure surveyId is a valid ObjectId
        if (!ObjectId.isValid(surveyId)) {
          return res.status(400).json({ message: "Invalid survey ID" });
        }

        // Construct the new comment object
        const newComment = {
          surveyId: new ObjectId(surveyId),
          userEmail,
          title,
          category,
          description,
          text,
          userName,
          userProfilePicture,
          createdAt: new Date(), // Optionally add a timestamp
        };

        // Insert the new comment into the database
        const result = await commentCollection.insertOne(newComment);

        // Send the result of the insert operation
        res.status(201).json(result);
      } catch (error) {
        // Handle any errors that occur during the operation
        res.status(500).json({ message: "Error adding comment", error });
      }
    });
    app.get("/comments/:surveyID", async (req, res) => {
      const surveyId = req.params.surveyID;
      const query = { surveyId: new ObjectId(surveyId) };
      const comments = await commentCollection.find(query).toArray();
      res.send(comments);
    });
    // Fetch all comments by user email
    app.get("/user/comments/:userEmail",verifyToken,verifyProUser, async (req, res) => {
      const { userEmail } = req.params;
      if (req.params.userEmail !== req.decoded.email) {
        return res.status(403).send({ message: 'forbidden access' });
      }
      try {
        // Find all comments by the user using userEmail
        const comments = await commentCollection.find({ userEmail }).toArray();
        if (comments.length === 0) {
          return res
            .status(404)
            .json({ message: "No comments found for this user" });
        }
        res.status(200).json(comments);
      } catch (error) {
        res.status(500).json({ message: "Error fetching comments", error });
      }
    });

    app.get("/vote/:surveyId", async (req, res) => {
      const { surveyId } = req.params;

      const query = { surveyId: surveyId };

      const votes = await voteCollection.find(query).toArray();

      if (votes.length === 0) {
        return res.status(404).send("No votes found for this survey");
      }

      res.json(votes);
    });

    // Fetch all surveys a user has participated in using userEmail
    app.get(
      "/user/:userEmail/participated-surveys",

      async (req, res) => {
        const { userEmail } = req.params;

        try {
          // Find all votes cast by the user using userEmail
          const votes = await voteCollection.find({ userEmail }).toArray();
          if (votes.length === 0) {
            return res
              .status(404)
              .json({ message: "No surveys found for this user" });
          }

          // Extract unique survey IDs
          const surveyIds = [...new Set(votes.map((vote) => vote.surveyId))];

          // Find surveys by IDs
          const surveys = await surveyCollection
            .find({ _id: { $in: surveyIds.map((id) => new ObjectId(id)) } })
            .toArray();

          res.status(200).json(surveys);
        } catch (error) {
          res.status(500).json({ message: "Error fetching surveys", error });
        }
      }
    );

    // Route to get surveys by user email
    app.get("/surveyor/surveys/:email",verifyToken,verifySurveyor, async (req, res) => {
      const email = req.params.email;
      const query = { userEmail: email };
      const result = await surveyCollection.find(query).toArray();
      res.send(result);
    });

    // Feedback endpoint
    app.post("/surveys/feedback/:id",verifyToken,verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const { feedback } = req.body;
      const survey = await surveyCollection.findOne({ _id: new ObjectId(id) });
      if (!survey) {
        return res.status(404).json({ message: "Survey not found" });
      }

      const result = await surveyCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "unpublish", feedback } }
      );

      if (result.modifiedCount === 1) {
        res
          .status(200)
          .json({ message: "Feedback submitted successfully", survey });
      } else {
        res.status(400).json({ message: "Failed to update survey" });
      }
    });
    // Endpoint to get feedback for all surveys
    app.get(
      "/api/surveys/feedbacks",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const feedbacks = await surveyCollection
            .find({ feedback: { $exists: true, $ne: "" } })
            .project({ title: 1, feedback: 1, status: 1 })
            .toArray();
          res.status(200).json(feedbacks);
        } catch (err) {
          res.status(500).json({ message: "Server error", error: err.message });
        }
      }
    );

    // API to get vote counts for a survey
    app.get("/surveys/:id/results", async (req, res) => {
      try {
        const voteCountsPipeline = [
          {
            $match: {
              surveyId: new ObjectId(req.params.id),
            },
          },
          {
            $unwind: "$responses",
          },
          {
            $group: {
              _id: {
                question: "$responses.question",
                option: "$responses.option",
              },
              voteCount: { $sum: 1 },
            },
          },
          {
            $group: {
              _id: "$_id.question",
              options: {
                $push: {
                  option: "$_id.option",
                  voteCount: "$voteCount",
                },
              },
            },
          },
          {
            $project: {
              _id: 0,
              question: "$_id",
              options: 1,
            },
          },
        ];

        const voteCounts = voteCollection
          .aggregate(voteCountsPipeline)
          .toArray();
        res.json(voteCounts);
      } catch (err) {
        res.status(500).json({ message: err.message });
      }
    });

    app.post("/surveys/:surveyId/vote",verifyToken, async (req, res) => {
      const surveyId = req.params.surveyId;
      const { userEmail, userName, responses } = req.body;

      const query = { surveyId, userEmail };
      const existingVote = await voteCollection.findOne(query);

      if (existingVote) {
        return res.status(200).json({ message: "You have already Voted" });
      }

      if (
        !surveyId ||
        !responses ||
        !Array.isArray(responses) ||
        responses.length !== 1
      ) {
        return res.status(400).json({ error: "Invalid request format" });
      }

      const { option } = responses[0];
      if (option !== 0 && option !== 1) {
        return res.status(400).json({ error: "Invalid option value" });
      }

      const newVote = {
        surveyId: surveyId,
        userEmail: userEmail,
        userName: userName,
        responses: responses,
      };

      try {
        await voteCollection.insertOne(newVote);

        // Increment the vote count in the survey collection
        let updateObj = { $inc: { voteCount: 1 } };
        if (option === 0) {
          updateObj.$inc.yesCount = 1;
        } else {
          updateObj.$inc.noCount = 1;
        }

        await surveyCollection.updateOne(
          { _id: new ObjectId(surveyId) },
          updateObj
        );

        res.status(201).send({ message: "Vote submitted successfully" });
      } catch (error) {
        res
          .status(500)
          .send({ message: "Error submitting vote", error: error.message });
      }
    });

    app.get("/surveys/:surveyId/voteCounts", async (req, res) => {
      const { surveyId } = req.params;

      try {
        const surveyObjectId = surveyId;
        console.log(surveyObjectId);
        const votesCount = await voteCollection
          .aggregate([
            {
              $match: { surveyId: surveyId },
            },
            {
              $unwind: "$responses",
            },
            {
              $group: {
                _id: "$responses.option",
                count: { $sum: 1 },
              },
            },
            {
              $project: {
                _id: 0,
                option: "$_id",
                count: 1,
              },
            },
          ])
          .toArray();

        res.status(200).send(votesCount);
      } catch (error) {
        console.error("Error fetching vote counts", error);
        res.status(500).json({ message: "Internal Server Error" });
      }
    });

    app.get("/surveys/:surveyId/votes", async (req, res) => {
      const surveyId = req.params.surveyId;
      const votes = await voteCollection.find({ surveyId: surveyId }).toArray();
      res.send(votes);
    });

    app.post("/surveys",verifyToken,verifySurveyor, async (req, res) => {
      try {
        const surveyData = {
          ...req.body,
          status: "publish",
          voteCount:0,
          timestamp: new Date(),
        };
        const result = await surveyCollection.insertOne(surveyData);
        res.send(result);
      } catch (error) {
        console.error("Error inserting survey", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.get("/surveys/user/:userId", async (req, res) => {
      const userId = req.params.userId;
      try {
        const surveys = await surveyCollection
          .find({ userId: userId })
          .toArray();
        res.status(200).send(surveys);
      } catch (error) {
        console.error("Error fetching surveys", error);
        res
          .status(500)
          .send({ message: "Internal Server Error", error: error.message });
      }
    });

    app.get("/surveys/:surveyId/responses", async (req, res) => {
      const surveyId = req.params.surveyId;
      try {
        const responses = await responsesCollection
          .find({ surveyId: surveyId })
          .toArray();
        res.status(200).send(responses);
      } catch (error) {
        console.error("Error fetching responses", error);
        res
          .status(500)
          .send({ message: "Internal Server Error", error: error.message });
      }
    });

    app.get(
      "/allSurveys/responses",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const votes = await voteCollection.find().toArray();
          if (votes.length === 0) {
            return res.status(404).send("No votes found for this survey");
          }
          res.status(200).send(votes);
        } catch (error) {
          console.error("Error fetching votes:", error);
          res.status(500).send("Error fetching votes");
        }
      }
    );

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
