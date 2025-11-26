# Use Playwright official image with browsers preinstalled
FROM mcr.microsoft.com/playwright:focal

# Create app directory
WORKDIR /usr/src/app

# Copy package.json first for caching
COPY package.json package-lock.json* ./ 

# Install dependencies
RUN npm install --production

# Copy the rest of the backend code
COPY . .

# Expose port 5000
EXPOSE 5000

# Start the server
CMD ["node", "server.js"]
