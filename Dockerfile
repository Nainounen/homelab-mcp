FROM node:22-alpine

WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled output and env template
COPY dist/ ./dist/
COPY .env.example ./

# The .env file must be mounted at runtime (see docker-compose.yml)
RUN echo 'require("dotenv").config(); require("./dist/index.js");' > /app/start.js

USER node
CMD ["node", "start.js"]
