# SIH Copilot

A Chrome extension that overlays the official Smart India Hackathon (SIH) problem-statement portal with a personal review workspace. It provides status tracking, advanced filtering, persistent notes, historical-repeat detection, and team-fit scoring — allowing you to evaluate hundreds of problem statements efficiently without losing track of what you've already reviewed.

## What Problem It Solves
The official SIH portal lists problem statements with no built-in workflow beyond plain browsing. There is no way to mark what you've read, no way to easily tell if a problem has appeared in a past year under a different name, and no persistent notes. SIH Copilot adds that critical layer directly on top of the existing portal — you do not need to visit a separate website to track your analysis.

## Main Features
- **SIH 2026 Problem-Statement Browsing**: Enhances the official SIH problem statement table.
- **Filtering & Search**: Advanced filtering by status, domain, organization type, and year.
- **Status Tagging**: Mark items as ⚪ Unread / 🟡 Revisit / 🟢 Selected / 🔴 Rejected. Saved automatically.
- **Notes**: Add per-problem-statement notes that persist across your sessions.
- **Historical Similarity ("Appeared Before")**: Automatically flags when a problem statement is semantically similar to one from a past SIH cycle.
- **Team Fit Scoring**: Configure your team's skills to get an automated team-fit score for each problem statement.
- **Major-Domain Tags**: Visual tags to quickly identify the domain of the problem statement.
- **Persistence & Local Storage**: All your tags, notes, and skill matrices are saved locally in your browser.

## Requirements
- Google Chrome browser (desktop).

## Installation

### Option 1 — Download the Latest Release (Recommended)

1. Go to the [Releases](https://github.com/mudassirdjsce/sih-copilot/releases) page.
2. Open the latest release (for example, **SIH Copilot v1.0.0**).
3. Under **Assets**, download:
   `sih-copilot-1.0.0.zip`
4. Extract the ZIP file to a folder on your computer.
5. Open Chrome and navigate to:
   `chrome://extensions`
6. Enable **Developer mode** using the toggle in the top-right corner.
7. Click **Load unpacked**.
8. Select the extracted `sih-copilot-1.0.0` folder — the folder that directly contains `manifest.json`.
9. Open the official [SIH 2026 problem statements](https://www.sih.gov.in/sih2026PS) page.

SIH Copilot should now appear automatically on the SIH problem-statement portal.

### Option 2 — For Developers

If you want to modify or contribute to the project:

1. Clone or download the repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the `extension/` folder inside the cloned repository.

See [How to Contribute/Fork](#how-to-contributefork) for development instructions.

## How to Use It
1. Once the extension is loaded, navigate to the official SIH 2026 problem statements page: [https://www.sih.gov.in/sih2026PS](https://www.sih.gov.in/sih2026PS).
2. The SIH Copilot interface will automatically overlay the page.
3. Use the new UI to filter and sort problem statements.
4. Click on a problem statement row to add notes and update its status.
5. Open the extension popup or settings to configure your Team Fit skills. The Copilot will use these configured skills to score each problem statement.

## How to Update It
1. Download the latest ZIP from the GitHub repository and extract it.
2. Replace your old folder with the new one.
3. Go to `chrome://extensions` and click the **Reload** icon on the SIH Copilot extension card.

## How to Uninstall It
1. Go to `chrome://extensions`.
2. Locate SIH Copilot and click the **Remove** button.
3. This will delete the extension and all associated local data (notes, statuses, etc.).

## How to Report Issues
If you encounter a bug or have a feature request, please file an issue on GitHub:
[https://github.com/mudassirdjsce/sih-copilot/issues](https://github.com/mudassirdjsce/sih-copilot/issues)

## How to Contribute/Fork
We welcome contributions! To contribute to SIH Copilot:
1. **Fork** the repository on GitHub.
2. **Clone** your fork locally: `git clone https://github.com/your-username/sih-copilot.git`
3. Create a new **branch**: `git checkout -b feature/my-new-feature`
4. Make your changes in the codebase.
5. **Test** locally using the "Load unpacked" method.
6. **Commit** your changes: `git commit -m "Add my new feature"`
7. **Push** the branch to your fork: `git push origin feature/my-new-feature`
8. Open a **Pull Request** to the main repository.

## Privacy Information
SIH Copilot is designed with privacy in mind:
- SIH problem-statement data is read directly from the SIH website.
- User-specific notes, status information, and team skill preferences are stored locally using Chrome storage.
- The project does not use an external backend for user-specific problem analysis.
- The project does not send user notes or team skills to an external AI API.
- Historical similarity uses the bundled/static historical dataset and local processing.
- The extension may fetch static model/runtime assets required for its embedding functionality as already implemented.

For more details, please review our [Privacy Policy](https://mudassirdjsce.github.io/sih-copilot/privacy-policy.html).

## Chrome Web Store Status
Chrome Web Store availability is in progress. Until the Store listing is published, SIH Copilot can be installed manually using Chrome's "Load unpacked" feature as described above.
