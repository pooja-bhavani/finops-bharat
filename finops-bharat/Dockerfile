FROM node:22-alpine AS frontend
WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_ENV=production \
    SSO_USER_HEADER=x-authenticated-user \
    STATIC_DIR=/app/static
WORKDIR /app/backend
COPY finops-bharat/backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY finops-bharat/backend/main.py finops-bharat/backend/scanner.py finops-bharat/backend/governance.py ./
COPY --from=frontend /build/dist /app/static
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
