FROM node:22-alpine AS frontend

WORKDIR /frontend
COPY package*.json ./
RUN npm ci

COPY index.html vite.config.js ./
COPY src ./src
ARG VITE_TWS_LABS_URL
ENV VITE_TWS_LABS_URL=${VITE_TWS_LABS_URL}
RUN npm run build

FROM python:3.11-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_ENV=production \
    AWS_DEFAULT_REGION=ap-south-1 \
    STATIC_DIR=/app/static

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY --from=frontend /frontend/dist/ ./static/

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
