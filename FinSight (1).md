# **FinSight AI: Project Implementation Plan**

This document outlines the step-by-step plan to build the "FinSight AI" web application, an educational tool for young investors. The architecture is designed to be secure and scalable using a full-stack approach on the Google Firebase platform.

## **1\. Project Overview**

### **Mission**

To demystify investing for beginners by providing daily, AI-powered educational insights on major market movements, focusing on the S\&P 500, Bitcoin, and Ethereum.

### **Core Features**

* **Daily AI Briefing:** An automated morning digest of market movements and the reasons behind them.  
* **Portfolio Simulator:** A virtual trading platform for risk-free learning (requires user authentication).  
* **"Explain It" Feature:** An AI-powered search tool to explain what any company does.

### **Technology Stack**

* **Frontend:** HTML, Tailwind CSS, JavaScript  
* **Backend:** Google Cloud Functions for Firebase (to securely handle API calls)  
* **Database:** Google Firebase (Firestore) for the portfolio simulator.  
* **Hosting:** Firebase Hosting  
* **Authentication:** Firebase Authentication  
* **Data APIs:** Alpha Vantage (or Finnhub) for stocks, CoinGecko for crypto.  
* **AI Model:** Google's Gemini API

## **2\. Phased Development Plan**

### **Phase 1: Setup & Backend Foundations (The First Weekend)**

The goal is to get your local environment and cloud infrastructure ready.

* \[ \] Task 1: Get API Keys.  
  * Sign up for API keys from Alpha Vantage, CoinGecko, and Google AI Studio. These keys will be stored securely on the backend.  
* \[ \] Task 2: Set Up Your Firebase Project.  
  * Create a new project in the Firebase Console.  
  * Install the Firebase CLI on your computer (npm install \-g firebase-tools).  
  * In your project folder, run firebase init and select **Hosting**, **Firestore**, and **Functions**.  
* \[ \] Task 3: Plan Your Functions.  
  * In functions/index.js (backend), outline the secure functions that will do the heavy lifting (e.g., getDailyBriefing, buyStock).  
  * In public/app.js (frontend), outline functions for UI interaction and calling your own Cloud Functions.

### **Phase 2: Build the Core Feature \- The Backend-Powered AI Briefing (2-3 Weeks)**

This phase focuses on making your main feature work securely. The frontend calls your backend, and the backend does all the work.

* \[ \] Task 1: Build the Backend Cloud Function.  
  * In functions/index.js, write a Node.js function (e.g., getDailyBriefing).  
  * This function will:  
    1. Securely fetch market data from Alpha Vantage and CoinGecko APIs.  
    2. Assemble the data into a dynamic prompt for the Gemini AI.  
    3. Make a POST request to the Gemini API.  
    4. Return the final, clean text as its own response.  
* \[ \] Task 2: Connect the Frontend to Your Cloud Function.  
  * In public/app.js, write a fetch function that calls the URL of your getDailyBriefing Cloud Function.  
* \[ \] Task 3: Display the AI Response.  
  * Use the response from your Cloud Function to set the .innerHTML of the relevant sections on your webpage.

### **Phase 3: Add the Portfolio Simulator (3-5 Weeks)**

This phase adds the main interactive component, using a secure backend-first approach.

* \[ \] Task 1: Implement Firebase Authentication.  
  * Add a user login/logout flow (e.g., Google Sign-In) to your frontend. This is a prerequisite for a personal portfolio.  
* \[ \] Task 2: Build the UI.  
  * Add HTML sections for the portfolio simulator: a form to "buy/sell" and a table to display holdings.  
* \[ \] Task 3: Implement Secure Trading Logic with Cloud Functions.  
  * In functions/index.js, create Cloud Functions like buyStock and sellStock.  
  * These functions will verify the user is logged in, securely fetch the current price of a stock, and then update that user's specific data in the Firestore database.  
* \[ \] Task 4: Display Portfolio Data from Firestore.  
  * Write a function in app.js that listens for real-time updates from Firestore to automatically update the portfolio display.

### **Phase 4: Deployment & Final Review (2-3 Days)**

Get your project online so you can share it.

* \[ \] Task 1: Deploy with the Firebase CLI.  
  * From your project's root directory, run the command firebase deploy. This single command deploys your Hosting, Functions, and Firestore rules.  
* \[ \] Task 2: Final Review.  
  * Ensure your disclaimer is clearly visible.  
  * Test the live app on both mobile and desktop browsers.

## **3\. Using Cursor AI to Accelerate Development**

Integrate Cursor into your workflow to speed up coding tasks.

* **For Generating Backend Code:**  
  * **Prompt:** *"Write me a Google Cloud Function in Node.js using axios that fetches the price of Bitcoin from the CoinGecko API."*  
  * **Why:** Saves time on backend syntax and asynchronous patterns.  
* **For Generating Frontend Code:**  
  * **Prompt:** *"Using the Firebase JS SDK v9, write a function that listens for a button click, calls the getDailyBriefing callable function, and displays the text response in a paragraph with the id ai-response."*  
  * **Why:** Quickly generates the boilerplate for connecting UI elements to your backend.  
* **For Debugging:**  
  * **Prompt:** *"This Cloud Function is giving me a timeout error in the Firebase logs. Here is my code. Can you spot the issue?"*  
  * **Why:** Helps find common backend problems like unhandled promises or incorrect API key configurations.

## **4\. Initial 5-Day Implementation Plan**

### **Day 1: Project Creation & Environment Setup**

* **Goal:** Create the central GitHub repository and get a local copy on both computers.  
* **Tasks:** One person creates the GitHub repo and invites the other as a collaborator. Both clone the repo and install the Firebase CLI.

### **Day 2: Firebase Initialization**

* **Goal:** Link the local project to a cloud Firebase project.  
* **Tasks:** One person creates the Firebase project and runs firebase init. They commit and push the new configuration files. The other person pulls the changes and runs npm install in the functions directory.

### **Day 3: Your First Backend Cloud Function**

* **Goal:** Create and test a simple "Hello World" Cloud Function using the branching workflow.  
* **Tasks:**  
  1. Create a new Git branch (feature/hello-world-function).  
  2. Use Cursor to generate a simple callable function in functions/index.js.  
  3. Test it locally using firebase emulators:start.  
  4. Commit and push the branch.

### **Day 4: Connect the Frontend**

* **Goal:** Make the website call the local function and display the result.  
* **Tasks:**  
  1. Create a new Git branch (feature/connect-frontend).  
  2. Use Cursor to generate basic HTML and the JavaScript to call the emulated function.  
  3. Test the full frontend-backend connection locally.  
  4. Commit and push the branch.

### **Day 5: Review, Merge, and Sync**

* **Goal:** Combine both features into the main project.  
* **Tasks:**  
  1. Both team members create Pull Requests (PRs) on GitHub.  
  2. Review each other's code.  
  3. Merge the PRs into the main branch.  
  4. Switch back to the main branch locally and run git pull to get the combined code.

## **5\. Estimated Project Timeline**

* **Total Duration:** 6 to 9 weeks.  
* **Assumptions:** 10-15 hours per week, with time allocated for learning and debugging.