# Use Playwright official image with browsers preinstalled
FROM mcr.microsoft.com/playwright:focal

# Create app directory
WORKDIR /usr/src/app

# Copy package.json first for caching
COPY package.json package-lock.json* ./ 

# Install deps (playwright image already has node & browsers)
RUN npm install --production

# Copy rest
COPY . .

# Expose port
EXPOSE 5000

# Start server
CMD ["node", "server.js"]
