CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS concepts (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  parent_id INT REFERENCES concepts(id),
  UNIQUE(name, subject, parent_id)
);

CREATE TABLE IF NOT EXISTS learning_targets (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  subject VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS target_topics (
  id SERIAL PRIMARY KEY,
  target_id INT NOT NULL REFERENCES learning_targets(id) ON DELETE CASCADE,
  topic_name VARCHAR(150) NOT NULL,
  mastery DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (mastery BETWEEN 0 AND 1),
  concept_id INT REFERENCES concepts(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(target_id, topic_name)
);

CREATE TABLE IF NOT EXISTS questions (
  id SERIAL PRIMARY KEY,
  concept_id INT NOT NULL REFERENCES concepts(id),
  text TEXT NOT NULL,
  options JSONB NOT NULL,
  answer_index INT NOT NULL,
  difficulty DOUBLE PRECISION NOT NULL CHECK (difficulty BETWEEN 0 AND 1),
  source VARCHAR(20) NOT NULL DEFAULT 'seed',
  explanation TEXT
);

CREATE TABLE IF NOT EXISTS attempts (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  question_id INT NOT NULL REFERENCES questions(id),
  correct BOOLEAN NOT NULL,
  time_seconds INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_states (
  user_id INT NOT NULL REFERENCES users(id),
  concept_id INT NOT NULL REFERENCES concepts(id),
  mastery DOUBLE PRECISION NOT NULL DEFAULT 0.5 CHECK (mastery BETWEEN 0 AND 1),
  attempts INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY(user_id, concept_id)
);

CREATE TABLE IF NOT EXISTS revision_sessions (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id INT NOT NULL REFERENCES learning_targets(id) ON DELETE CASCADE,
  mode VARCHAR(30) NOT NULL CHECK (mode IN ('complete', 'topic')),
  topic_concept_id INT REFERENCES concepts(id),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
  question_count INT NOT NULL DEFAULT 0,
  correct_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS revision_session_topics (
  session_id INT NOT NULL REFERENCES revision_sessions(id) ON DELETE CASCADE,
  concept_id INT NOT NULL REFERENCES concepts(id),
  asked_count INT NOT NULL DEFAULT 0,
  correct_count INT NOT NULL DEFAULT 0,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  PRIMARY KEY(session_id, concept_id)
);

CREATE INDEX IF NOT EXISTS attempts_user_created_idx ON attempts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS attempts_question_idx ON attempts(question_id);
CREATE INDEX IF NOT EXISTS questions_concept_idx ON questions(concept_id);
CREATE INDEX IF NOT EXISTS target_topics_target_idx ON target_topics(target_id);
CREATE INDEX IF NOT EXISTS knowledge_states_user_updated_idx ON knowledge_states(user_id, updated_at DESC);

INSERT INTO users(name,email)
VALUES ('Demo Student','demo@example.com')
ON CONFLICT(email) DO NOTHING;

INSERT INTO concepts(name,subject,parent_id) VALUES
('Arrays','DSA',NULL),('Binary Search','DSA',NULL),('Graphs','DSA',NULL),('Dynamic Programming','DSA',NULL),
('SQL','DBMS',NULL),('Transactions','DBMS',NULL),('Normalization','DBMS',NULL),('Indexing','DBMS',NULL),
('Processes','OS',NULL),('Paging','OS',NULL)
ON CONFLICT DO NOTHING;

INSERT INTO concepts(name,subject,parent_id)
SELECT v.name, 'DSA', p.id
FROM (VALUES
 ('Arrays','Traversal & Basic Operations'),('Arrays','Prefix Sum'),('Arrays','Two Pointers'),('Arrays','Sliding Window'),('Arrays','Hashing'),('Arrays','Kadane''s Algorithm'),('Arrays','Sorting-based Problems'),
 ('Binary Search','Basic Binary Search'),('Binary Search','Lower/Upper Bound'),('Binary Search','Search on Answer'),('Binary Search','Rotated Sorted Array'),('Binary Search','Binary Search on 2D Matrix'),
 ('Graphs','BFS'),('Graphs','DFS'),('Graphs','Cycle Detection'),('Graphs','Topological Sort'),('Graphs','Shortest Path'),('Graphs','Dijkstra'),('Graphs','Minimum Spanning Tree'),('Graphs','Disjoint Set Union'),
 ('Dynamic Programming','1D DP'),('Dynamic Programming','2D DP'),('Dynamic Programming','Knapsack'),('Dynamic Programming','Subsequence DP'),('Dynamic Programming','Grid DP'),('Dynamic Programming','DP on Strings')
) AS v(parent_name,name)
JOIN concepts p ON p.name=v.parent_name AND p.subject='DSA' AND p.parent_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO questions(concept_id,text,options,answer_index,difficulty,source,explanation)
SELECT c.id,'What is the time complexity of binary search?','["O(1)","O(log n)","O(n)","O(n log n)"]',1,0.35,'seed','Binary search halves the remaining search interval at each step.'
FROM concepts c WHERE c.name='Binary Search' AND c.parent_id IS NULL
AND NOT EXISTS (SELECT 1 FROM questions q WHERE q.text='What is the time complexity of binary search?');

INSERT INTO questions(concept_id,text,options,answer_index,difficulty,source,explanation)
SELECT c.id,'Which traversal is naturally suited to finding shortest paths in an unweighted graph?','["DFS","BFS","Dijkstra","Kruskal"]',1,0.40,'seed','BFS explores vertices in increasing number of edges from the source.'
FROM concepts c WHERE c.name='Graphs' AND c.parent_id IS NULL
AND NOT EXISTS (SELECT 1 FROM questions q WHERE q.text LIKE 'Which traversal is naturally suited%');

INSERT INTO questions(concept_id,text,options,answer_index,difficulty,source,explanation)
SELECT c.id,'Which data structure is commonly used for O(1) average lookup by key?','["Stack","Queue","Hash table","Linked list"]',2,0.30,'seed','A hash table provides expected constant-time key lookup under normal hashing assumptions.'
FROM concepts c WHERE c.name='Arrays' AND c.parent_id IS NULL
AND NOT EXISTS (SELECT 1 FROM questions q WHERE q.text LIKE 'Which data structure is commonly%');

INSERT INTO questions(concept_id,text,options,answer_index,difficulty,source,explanation)
SELECT c.id,'Which technique stores the result of expensive recursive subproblems?','["Memoization","Hashing","Pipelining","Paging"]',0,0.45,'seed','Memoization caches results of overlapping subproblems.'
FROM concepts c WHERE c.name='Dynamic Programming' AND c.parent_id IS NULL
AND NOT EXISTS (SELECT 1 FROM questions q WHERE q.text LIKE 'Which technique stores%');
