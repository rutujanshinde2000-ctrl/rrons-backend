# Use Playwright official image
FROM mcr.microsoft.com/playwright:focal

# Create app directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install --production

# Copy ALL project files
COPY . .

# Expose port
EXPOSE 5000

# Start server
CMD ["node", "server.js"]
