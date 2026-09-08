# GitHub Pages Setup

To obtain a public URL for the Privacy Policy required by the Chrome Web Store, you must host it using GitHub Pages.

Since your repository is configured as `https://github.com/mudassirdjsce/sih-copilot.git`, follow these steps after pushing:

1. Push your repository to GitHub:
   ```bash
   git push -u origin main
   ```
2. Open your GitHub repository in the browser: https://github.com/mudassirdjsce/sih-copilot
3. Go to **Settings** → **Pages** (in the left sidebar).
4. Under **Build and deployment**, set the **Source** to **Deploy from a branch**.
5. Under **Branch**, select your main branch (e.g., `main` or `master`), and change the folder selection from `/ (root)` to `/docs`.
6. Click **Save**.
7. Wait a few minutes for the GitHub Actions deployment to finish. 
8. Verify your published privacy policy at:
   https://mudassirdjsce.github.io/sih-copilot/privacy-policy.html

This is the URL you will provide to the Chrome Web Store during submission.
