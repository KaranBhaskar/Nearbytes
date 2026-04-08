#!/bin/bash
echo "🚀 Initializing Nearby Bites..."
npm install
mkdir -p uploads
# Check for .env.local, create if missing
if [ ! -f .env.local ]; then
  cp .env.example .env.local
  echo "📝 Created .env.local from .env.example."
fi
echo "✅ Setup complete."
echo "Next steps:"
echo "1. Optionally run 'npx convex dev' if you are the Convex owner."
echo "2. Run 'npm run dev' to start the static app."
