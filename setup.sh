#!/bin/bash
echo "🚀 Initializing Nearby Bites..."
npm install
mkdir -p uploads
# Check for .env, create if missing
if [ ! -f .env ]; then
  echo "JWT_SECRET=demo-secret-123" > .env
  echo "DB_PATH=./app.db" >> .env
  echo "📝 Created .env with default test values."
fi
echo "✅ Setup complete. Use 'npm test' to verify the build."