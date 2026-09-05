# Adaptive Study Intelligence Platform

An adaptive learning system that combines PostgreSQL knowledge tracking, a quantitative ML success predictor, and Gemini-generated questions.

## Architecture

Student → Learning Target → Topic/Subtopic Knowledge State → ML Success Predictor → Adaptive Controller → Gemini Question Generator → Validator → Attempt → Knowledge Update → repeat

## Stack

- Backend: Node.js 18 + Express + PostgreSQL
- AI: Gemini via `@google/generative-ai`
- ML: Python + FastAPI + scikit-learn
- Frontend: React + Vite

## Requirements

- Node.js 18+
- Python 3.10+
- PostgreSQL
- Gemini API key

## Setup

### 1. Database

Create a PostgreSQL database/user and run:

```bash
psql -h localhost -U study -d study_ai -f db/init.sql
```

If the database already contains the earlier project schema, run:

```bash
psql -h localhost -U study -d study_ai -f db/migrate.sql
```

### 2. Backend

```bash
cd backend
npm install
```

Create `backend/.env`:

```env
PORT=4000
ML_URL=http://localhost:8000
DATABASE_URL=postgresql://study:study@localhost:5432/study_ai
GEMINI_API_KEY=YOUR_KEY_HERE
```

Run:

```bash
npm start
```

### 3. ML service

```bash
cd ml
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python train.py
uvicorn main:app --host 0.0.0.0 --port 8000
```

The model is a **synthetic-data baseline**. Its metrics are not learning-outcome claims.

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL shown in the terminal.

## Important

Gemini generation requires internet access. If a network blocks Google AI traffic, use another network/hotspot.
