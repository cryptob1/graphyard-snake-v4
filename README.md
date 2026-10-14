# Autonomous Snake Game Pilot v4

The GitHub Pages deployment publishes `deployment.json` at the site root. Its
`sha` field is the exact commit packaged by the Pages workflow. Deployment
verification can read this public URL when the GitHub deployments API is rate
limited. The workflow checks that the live endpoint reports its own commit.
