import math, os, joblib
import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel, Field

app=FastAPI(title='Adaptive Study ML Service')
MODEL_PATH=os.path.join(os.path.dirname(__file__),'model.joblib')
model=joblib.load(MODEL_PATH) if os.path.exists(MODEL_PATH) else None

class Prediction(BaseModel):
    mastery: float=Field(ge=0,le=1)
    difficulty: float=Field(ge=0,le=1)
    attempts: int=Field(ge=0)
    recency_days: float=Field(ge=0,default=0)
    avg_time_ratio: float=Field(gt=0,default=1)

@app.get('/health')
def health():
    return {'ok':True,'model':{'model':'logistic_regression','loaded':model is not None,'features':['mastery','difficulty','attempts','log_attempts','recency_days','avg_time_ratio','mastery_minus_difficulty'],'training_data':'synthetic baseline'}}

@app.post('/predict')
def predict(p:Prediction):
    x=np.array([[p.mastery,p.difficulty,p.attempts,math.log1p(p.attempts),p.recency_days,p.avg_time_ratio,p.mastery-p.difficulty]])
    probability=float(model.predict_proba(x)[0,1]) if model else max(.05,min(.95,.5+.5*(p.mastery-p.difficulty)))
    return {'success_probability':round(probability,4),'mastery':p.mastery,'difficulty':p.difficulty}
