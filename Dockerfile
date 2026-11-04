FROM node:20-slim

WORKDIR /app

# Copy package files and install dependencies
COPY Docuchat-main/server/package*.json ./
RUN npm install --production

# Copy server files and pre-compiled Flutter Web build in public/
COPY Docuchat-main/server/ ./

# Hugging Face Spaces exposes port 7860 by default
ENV PORT=7860
EXPOSE 7860

CMD ["npm", "start"]
