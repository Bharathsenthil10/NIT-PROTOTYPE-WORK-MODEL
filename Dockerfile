# Dockerfile for Order-to-Audit System
FROM node:24-alpine

WORKDIR /app

# Copy package files
COPY package.json ./

# Copy application source code
COPY . .

# Set environment
ENV PORT=3000
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Run seed and start server
CMD ["sh", "-c", "node seed.js && node server.js"]
