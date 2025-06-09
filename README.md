# Photospace.app

A privacy-first OneDrive photo library analyzer. This tool helps you find and remove groups of similar photos to free up space. All processing happens directly in your browser. Your photos are never uploaded to a third-party server.

## Features (Version 1)

- Secure login with your Microsoft Account.
- Fetches all photo metadata from your OneDrive.
- Generates image embeddings locally using a Web Worker and Transformers.js.
- Stores all data locally in your browser's IndexedDB.
- Analyzes photos by grouping them first by time ("sessions") and then by visual similarity.
- Displays groups of similar photos, ranked by the highest potential for reduction.

## Setup & Running Locally

1.  **Clone the repository:**
    ```bash
    git clone <your-repo-url>
    cd photospace-app
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Configure Azure App ID:**
    You need to create a file named `.env.local` in the root of the project and add your Azure Application (Client) ID to it.

    Create the file `.env.local`:
    ```
    VITE_AZURE_CLIENT_ID="YOUR_AZURE_APP_CLIENT_ID_HERE"
    ```
    Replace `YOUR_AZURE_APP_CLIENT_ID_HERE` with the actual ID from your Azure App Registration.

    **Important:** In your Azure App Registration, under **Authentication**, make sure you have configured a **Single-page application (SPA)** platform with the redirect URI: `http://localhost:5173` (or whatever port Vite uses). You will need to add your final production URL (`https://photospace.app`) here as well.

4.  **Run the development server:**
    ```bash
    npm run dev
    ```
    Open your browser and navigate to the local URL provided by Vite.

## Deployment

This project includes a GitHub Action workflow to automatically build and deploy the application to GitHub Pages whenever you push to the `main` branch.

To enable it:
1. Push your code to a GitHub repository.
2. In your repository settings, under **Pages**, select **GitHub Actions** as the source.
3. Ensure the `CNAME` file contains your custom domain (`photospace.app`).
4. Configure your domain's DNS records to point to GitHub Pages.