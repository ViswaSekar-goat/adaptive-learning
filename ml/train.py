import math
import random
import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, roc_auc_score

random.seed(42); np.random.seed(42)
rows=[]; labels=[]
for _ in range(30000):
    mastery=np.random.beta(2.2,2.2)
    difficulty=np.random.beta(2.2,2.2)
    attempts=np.random.poisson(4)
    recency_days=np.random.exponential(7)
    avg_time_ratio=np.clip(np.random.lognormal(0,0.35),0.4,3.0)
    log_attempts=math.log1p(attempts)
    mastery_minus_difficulty=mastery-difficulty
    logit=2.6*mastery-2.4*difficulty+0.22*log_attempts-0.045*recency_days-0.28*(avg_time_ratio-1)+0.9*mastery_minus_difficulty
    prob=1/(1+math.exp(-logit))
    labels.append(np.random.rand()<prob)
    rows.append([mastery,difficulty,attempts,log_attempts,recency_days,avg_time_ratio,mastery_minus_difficulty])
X=np.array(rows); y=np.array(labels,dtype=int)
Xtr,Xte,ytr,yte=train_test_split(X,y,test_size=.2,random_state=42,stratify=y)
model=LogisticRegression(max_iter=1000).fit(Xtr,ytr)
pred=model.predict_proba(Xte)[:,1]
print({'samples':len(X),'test_accuracy':round(accuracy_score(yte,pred>=.5),4),'test_auc':round(roc_auc_score(yte,pred),4)})
joblib.dump(model,'model.joblib')
