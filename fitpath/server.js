const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 4173);
const APP_BASE_URL = (process.env.APP_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const SECURE_COOKIE = APP_BASE_URL.startsWith('https://') ? '; Secure' : '';
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'fitpath.sqlite'));
class ValidationError extends Error {}
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    salt TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user',
    steps_goal INTEGER NOT NULL DEFAULT 8000,
    calories_goal INTEGER NOT NULL DEFAULT 2000, gender TEXT, height_cm REAL, weight_kg REAL, bmi REAL, birth_date TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS admin_actions (
    id INTEGER PRIMARY KEY,
    admin_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    admin_email TEXT NOT NULL,
    action TEXT NOT NULL,
    target_user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_admin_actions_created ON admin_actions(created_at);
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    activity_type TEXT NOT NULL, activity_date TEXT NOT NULL, duration_min REAL NOT NULL,
    duration_unit TEXT NOT NULL DEFAULT 'minutes', distance_km REAL, distance_unit TEXT NOT NULL DEFAULT 'km',
    steps INTEGER, intensity TEXT NOT NULL DEFAULT 'Moderate', notes TEXT NOT NULL DEFAULT '',
    calories INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS foods (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, category TEXT NOT NULL,
    serving TEXT NOT NULL, calories REAL NOT NULL, protein REAL NOT NULL, carbs REAL NOT NULL, fat REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS food_logs (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    food_id INTEGER NOT NULL REFERENCES foods(id), meal TEXT NOT NULL, servings REAL NOT NULL,
    logged_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS body_metrics (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    weight_kg REAL NOT NULL, waist_cm REAL, hip_cm REAL, logged_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sleep_logs (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sleep_date TEXT NOT NULL, bedtime TEXT NOT NULL, waketime TEXT NOT NULL,
    quality INTEGER NOT NULL, energy INTEGER NOT NULL, notes TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL, metric TEXT NOT NULL, target REAL NOT NULL, unit TEXT NOT NULL,
    deadline TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS exercises (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, muscle_group TEXT NOT NULL,
    equipment TEXT NOT NULL, difficulty TEXT NOT NULL, instructions TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workout_sessions (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL, workout_date TEXT NOT NULL, duration_min INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS workout_sets (
    id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id), set_no INTEGER NOT NULL,
    reps INTEGER, weight_kg REAL, duration_sec INTEGER, notes TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_activities_user_date ON activities(user_id, activity_date);
  CREATE INDEX IF NOT EXISTS idx_food_logs_user_date ON food_logs(user_id, logged_at);
  CREATE INDEX IF NOT EXISTS idx_body_user_date ON body_metrics(user_id, logged_at);
  CREATE INDEX IF NOT EXISTS idx_sleep_user_date ON sleep_logs(user_id, sleep_date);
  CREATE INDEX IF NOT EXISTS idx_workouts_user_date ON workout_sessions(user_id, workout_date);
`);
const activityColumns = new Set(db.prepare('PRAGMA table_info(activities)').all().map(column => column.name));
for (const [name,declaration] of [['duration_unit',"TEXT NOT NULL DEFAULT 'minutes'"],['distance_unit',"TEXT NOT NULL DEFAULT 'km'"]]) { if (!activityColumns.has(name)) db.exec(`ALTER TABLE activities ADD COLUMN ${name} ${declaration}`); }
const priorWaterTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='water_logs'").get();
const priorWaterGoal = db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'water_goal_ml');
const priorWaterGoals = db.prepare("SELECT 1 FROM goals WHERE metric='water_ml' LIMIT 1").get();
if (priorWaterTable || priorWaterGoal || priorWaterGoals) {
  db.exec("PRAGMA secure_delete=ON; DELETE FROM goals WHERE metric='water_ml'; DROP TABLE IF EXISTS water_logs;");
  if (priorWaterGoal) db.exec('ALTER TABLE users DROP COLUMN water_goal_ml');
  db.exec('VACUUM; PRAGMA wal_checkpoint(TRUNCATE);');
}
const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map(column => column.name));
for (const [name, declaration] of [['gender','TEXT'],['height_cm','REAL'],['weight_kg','REAL'],['bmi','REAL'],['birth_date','TEXT'],['last_active_at','TEXT']]) {
  if (!userColumns.has(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${declaration}`);
}
if (!db.prepare('PRAGMA table_info(activities)').all().some(column => column.name === 'steps')) db.exec('ALTER TABLE activities ADD COLUMN steps INTEGER');
const configuredAdminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const configuredAdminPassword = process.env.ADMIN_PASSWORD || '';
if (configuredAdminEmail) {
  const existingAdmin = db.prepare('SELECT id FROM users WHERE lower(email)=?').get(configuredAdminEmail);
  if (existingAdmin) db.prepare("UPDATE users SET role='admin',name='Zeus' WHERE id=?").run(existingAdmin.id);
  else if (configuredAdminPassword) {
    if (configuredAdminPassword.length < 10) throw new Error('ADMIN_PASSWORD must be at least 10 characters.');
    const adminSalt = crypto.randomBytes(16).toString('hex');
    db.prepare("INSERT INTO users(name,email,salt,password_hash,role) VALUES(?,?,?,?, 'admin')").run('Zeus',configuredAdminEmail,adminSalt,hashPassword(configuredAdminPassword,adminSalt));
  }
}

const foodSeeds = [
  ['Rolled oats','Grains','50 g',190,6.5,33,3.5],['Greek yogurt','Dairy','170 g',100,17,6,0],['Banana','Fruit','1 medium',105,1.3,27,0.4],
  ['Chicken breast','Protein','100 g',165,31,0,3.6],['Brown rice','Grains','1 cup cooked',216,5,45,1.8],['Avocado','Fruit','50 g',80,1,4.3,7.4],
  ['Egg','Protein','1 large',72,6.3,0.4,4.8],['Salmon','Protein','100 g',208,20,0,13],['Almonds','Snack','28 g',164,6,6,14],['Spinach','Vegetable','2 cups',14,1.7,2.2,0.2],
  ['Wholegrain toast','Grains','1 slice',110,4,19,1.5],['Blueberries','Fruit','100 g',57,0.7,14.5,0.3]
];
const exerciseSeeds = [
  ['Goblet squat','Legs','Dumbbell','Beginner','Hold one dumbbell at chest height, sit hips down, then stand tall.'],
  ['Romanian deadlift','Legs','Barbell','Intermediate','Hinge at the hips with a neutral back and lower the bar along your legs.'],
  ['Push-up','Chest','Bodyweight','Beginner','Keep a straight body line and lower your chest under control.'],
  ['Dumbbell row','Back','Dumbbell','Beginner','Brace on a bench and row the dumbbell toward your hip.'],
  ['Overhead press','Shoulders','Dumbbell','Intermediate','Press from shoulder height while keeping your ribs stacked.'],
  ['Lat pulldown','Back','Cable','Beginner','Pull the bar toward your upper chest without leaning far back.'],
  ['Plank','Core','Bodyweight','Beginner','Brace your core and hold a straight line from head to heels.'],
  ['Lunge','Legs','Bodyweight','Beginner','Step into a comfortable lunge and push through the front foot to return.'],
  ['Bench press','Chest','Barbell','Intermediate','Lower the bar to mid chest with wrists stacked over elbows.'],
  ['Bicycle crunch','Core','Bodyweight','Beginner','Rotate slowly, bringing opposite elbow and knee together.'],
  ['Bicep curl','Arms','Dumbbell','Beginner','Curl without swinging, then lower with control.'],
  ['Glute bridge','Glutes','Bodyweight','Beginner','Drive through your heels and squeeze your glutes at the top.']
];
const insertFood = db.prepare('INSERT OR IGNORE INTO foods(name,category,serving,calories,protein,carbs,fat) VALUES(?,?,?,?,?,?,?)');
for (const row of foodSeeds) insertFood.run(...row);
const additionalExerciseSeeds = [
  ['Pull-up','Back','Pull-up bar','Intermediate','Hang from the bar, pull your chest upward, then lower with control.'],
  ['Chin-up','Back','Pull-up bar','Intermediate','Use an underhand grip, pull your chin above the bar, then lower slowly.'],
  ['Assisted pull-up','Back','Assisted machine','Beginner','Set assistance, pull your chest toward the bar, then lower with control.'],
  ['Wide-grip lat pulldown','Back','Cable','Beginner','Pull the wide bar toward your upper chest while keeping your torso steady.'],
  ['Close-grip lat pulldown','Back','Cable','Beginner','Pull the close-grip handle toward your upper chest without swinging.'],
  ['Seated cable row','Back','Cable','Beginner','Sit tall and pull the handle toward your waist, then reach forward slowly.'],
  ['Close-grip seated cable row','Back','Cable','Beginner','Keep your torso steady and pull the close handle toward your lower ribs.'],
  ['Barbell bent-over row','Back','Barbell','Intermediate','Hinge at the hips and row the bar toward your lower ribs.'],
  ['Chest-supported dumbbell row','Back','Dumbbell','Beginner','Lie chest-down on an incline bench and row both dumbbells toward your hips.'],
  ['T-bar row','Back','T-bar machine','Intermediate','Brace your torso and row the handles toward your lower chest.'],
  ['Single-arm cable row','Back','Cable','Beginner','Pull one handle toward your waist while keeping your torso square.'],
  ['Straight-arm pulldown','Back','Cable','Beginner','Keep your arms nearly straight and pull the bar down toward your thighs.'],
  ['Back extension','Back','Back extension bench','Beginner','Hinge at the hips and raise your torso until it is in line with your legs.'],
  ['Rack pull','Back','Barbell','Intermediate','Lift the bar from rack supports to standing, keeping it close to your legs.'],
  ['Inverted row','Back','Smith machine or bar','Beginner','Keep your body straight and pull your chest toward the bar.'],
  ['Incline barbell bench press','Chest','Barbell','Intermediate','Lower the bar to your upper chest and press it up with control.'],
  ['Incline dumbbell chest press','Chest','Dumbbell','Beginner','Press the dumbbells from upper chest level while lying on an incline bench.'],
  ['Decline bench press','Chest','Barbell','Intermediate','Lower the bar toward your lower chest and press it up steadily.'],
  ['Dumbbell chest press','Chest','Dumbbell','Beginner','Lower dumbbells beside your chest and press them upward.'],
  ['Cable chest fly','Chest','Cable','Beginner','Bring the cable handles together in front of your chest with a soft elbow bend.'],
  ['Incline cable fly','Chest','Cable','Beginner','Bring the low cable handles together in front of your upper chest.'],
  ['Pec deck fly','Chest','Pec deck machine','Beginner','Bring the machine pads together in front of your chest, then return slowly.'],
  ['Machine chest press','Chest','Chest press machine','Beginner','Press the handles forward and return until your elbows are comfortably back.'],
  ['Dumbbell pullover','Chest','Dumbbell','Intermediate','Lower one dumbbell behind your head with a slight elbow bend, then bring it over your chest.'],
  ['Arnold press','Shoulders','Dumbbell','Intermediate','Rotate the dumbbells as you press from shoulder height overhead.'],
  ['Dumbbell lateral raise','Shoulders','Dumbbell','Beginner','Raise the dumbbells out to your sides to shoulder height with soft elbows.'],
  ['Cable lateral raise','Shoulders','Cable','Beginner','Raise one cable handle out to the side to shoulder height.'],
  ['Dumbbell front raise','Shoulders','Dumbbell','Beginner','Raise the dumbbells in front of you to shoulder height.'],
  ['Rear delt dumbbell fly','Shoulders','Dumbbell','Beginner','Hinge forward and raise the dumbbells out to your sides.'],
  ['Face pull','Shoulders','Cable','Beginner','Pull the rope toward your face with elbows high and shoulder blades moving back.'],
  ['Reverse pec deck','Shoulders','Reverse pec deck machine','Beginner','Open your arms out and back against the machine pads.'],
  ['Upright row','Shoulders','Barbell or dumbbell','Intermediate','Pull the weight upward close to your body, stopping around chest height.'],
  ['Machine shoulder press','Shoulders','Shoulder press machine','Beginner','Press the handles overhead and lower them to shoulder level.'],
  ['Dumbbell shrug','Shoulders','Dumbbell','Beginner','Raise your shoulders toward your ears, pause briefly, then lower.'],
  ['Barbell curl','Biceps','Barbell','Beginner','Curl the bar toward your shoulders without swinging your torso.'],
  ['EZ-bar curl','Biceps','EZ bar','Beginner','Curl the EZ bar upward while keeping your elbows near your sides.'],
  ['Hammer curl','Biceps','Dumbbell','Beginner','Curl with palms facing each other and lower the dumbbells slowly.'],
  ['Incline dumbbell curl','Biceps','Dumbbell','Intermediate','Curl the dumbbells while seated against an incline bench.'],
  ['Preacher curl','Biceps','Preacher curl bench','Beginner','Curl the weight while keeping your upper arms supported on the pad.'],
  ['Concentration curl','Biceps','Dumbbell','Beginner','Brace your upper arm against your thigh and curl one dumbbell at a time.'],
  ['Cable biceps curl','Biceps','Cable','Beginner','Curl the low cable handle toward your shoulders while keeping your elbows still.'],
  ['High cable curl','Biceps','Cable','Intermediate','With arms out to your sides, curl the handles toward your head.'],
  ['Reverse curl','Biceps','Barbell or EZ bar','Beginner','Curl with palms facing down and keep your wrists steady.'],
  ['Rope triceps pushdown','Triceps','Cable','Beginner','Push the rope down until your arms straighten, keeping elbows by your sides.'],
  ['Straight-bar triceps pushdown','Triceps','Cable','Beginner','Push the bar down while keeping your upper arms still.'],
  ['Overhead cable triceps extension','Triceps','Cable','Beginner','Extend the rope overhead while keeping your elbows pointed forward.'],
  ['EZ-bar skull crusher','Triceps','EZ bar','Intermediate','Bend your elbows to lower the bar near your forehead, then extend them.'],
  ['Close-grip bench press','Triceps','Barbell','Intermediate','Use a comfortable narrow grip and press the bar from your chest.'],
  ['Bench dip','Triceps','Bench','Beginner','Bend your elbows to lower your body, then press back up.'],
  ['Overhead dumbbell triceps extension','Triceps','Dumbbell','Beginner','Lower one dumbbell behind your head by bending your elbows, then extend.'],
  ['Cable triceps kickback','Triceps','Cable','Beginner','Extend your arm behind you while keeping your upper arm steady.'],
  ['Diamond push-up','Triceps','Bodyweight','Intermediate','Place hands close together and lower your chest with a straight body line.'],
  ['Crunch','Core & Abs','Bodyweight','Beginner','Curl your shoulders gently off the floor while keeping your lower back down.'],
  ['Reverse crunch','Core & Abs','Bodyweight','Beginner','Bring your knees toward your chest and curl your hips slightly off the floor.'],
  ['Hanging knee raise','Core & Abs','Pull-up bar','Intermediate','Hang steadily and lift your knees toward your chest without swinging.'],
  ['Hanging leg raise','Core & Abs','Pull-up bar','Advanced','Hang steadily and raise your legs in front of you without swinging.'],
  ['Russian twist','Core & Abs','Bodyweight or medicine ball','Beginner','Lean back slightly and rotate your shoulders from side to side.'],
  ['Dead bug','Core & Abs','Bodyweight','Beginner','Lower opposite arm and leg while keeping your lower back gently on the floor.'],
  ['Ab wheel rollout','Core & Abs','Ab wheel','Advanced','Roll the wheel forward while bracing your trunk, then return under control.'],
  ['Flutter kick','Core & Abs','Bodyweight','Beginner','Lie on your back and alternate small controlled leg lifts.'],
  ['Toe touch crunch','Core & Abs','Bodyweight','Beginner','Reach toward your toes while curling your shoulders off the floor.'],
  ['V-up','Core & Abs','Bodyweight','Intermediate','Lift your legs and torso together and reach toward your feet.'],
  ['Side plank','Core & Abs','Bodyweight','Beginner','Hold a straight line on one forearm, then repeat on the other side.'],
  ['Mountain climber','Core & Abs','Bodyweight','Beginner','From a plank, alternate bringing each knee toward your chest.'],
  ['Pallof press','Core & Abs','Cable or resistance band','Beginner','Press the handle straight ahead and resist rotation through your torso.'],
  ['Cable crunch','Core & Abs','Cable','Beginner','Kneel at the cable and curl your ribs toward your hips.'],
  ['Cable wood chop','Core & Abs','Cable','Beginner','Pull the handle diagonally across your body with a controlled trunk rotation.'],
  ['Bird dog','Core & Abs','Bodyweight','Beginner','From hands and knees, extend opposite arm and leg while keeping your back steady.'],
  ['Hollow body hold','Core & Abs','Bodyweight','Intermediate','Brace your core and hold your shoulders and legs slightly off the floor.'],
  ['Barbell back squat','Quads','Barbell','Intermediate','Sit between your hips with the bar balanced across your upper back.'],
  ['Barbell front squat','Quads','Barbell','Intermediate','Keep your torso tall and squat with the bar supported at your shoulders.'],
  ['Leg press','Quads','Leg press machine','Beginner','Lower the platform until your knees are comfortably bent, then press it away.'],
  ['Hack squat','Quads','Hack squat machine','Beginner','Lower into a squat on the machine and press through your feet to stand.'],
  ['Leg extension','Quads','Leg extension machine','Beginner','Straighten your knees against the pad, then lower the weight slowly.'],
  ['Bulgarian split squat','Quads','Dumbbell or bodyweight','Intermediate','Place your rear foot on a bench and lower under control on the front leg.'],
  ['Step-up','Quads','Bench or box','Beginner','Step onto a stable platform and stand tall before stepping down.'],
  ['Walking lunge','Quads','Dumbbell or bodyweight','Beginner','Step forward into alternating lunges while keeping your torso upright.'],
  ['Reverse lunge','Quads','Dumbbell or bodyweight','Beginner','Step backward into a lunge and push through the front foot to stand.'],
  ['Split squat','Quads','Dumbbell or bodyweight','Beginner','Use a staggered stance and lower straight down, then return to standing.'],
  ['Wall sit','Quads','Bodyweight','Beginner','Slide down a wall until your knees are bent comfortably and hold.'],
  ['Seated leg curl','Hamstrings','Leg curl machine','Beginner','Curl your heels down and back against the pad, then release slowly.'],
  ['Lying leg curl','Hamstrings','Leg curl machine','Beginner','Curl your heels toward your hips while lying face down.'],
  ['Nordic hamstring curl','Hamstrings','Bodyweight or partner','Advanced','Lower your torso forward slowly from a kneeling position, using your hamstrings to resist.'],
  ['Dumbbell Romanian deadlift','Hamstrings','Dumbbell','Beginner','Hinge at the hips and lower the dumbbells along your legs with a neutral back.'],
  ['Barbell stiff-leg deadlift','Hamstrings','Barbell','Intermediate','Hinge with a slight knee bend and lower the bar along your legs.'],
  ['Good morning','Hamstrings','Barbell','Intermediate','Hinge at the hips with the bar across your upper back and a neutral spine.'],
  ['Single-leg Romanian deadlift','Hamstrings','Dumbbell or bodyweight','Intermediate','Hinge on one leg while reaching the other leg back for balance.'],
  ['Glute-ham raise','Hamstrings','Glute-ham developer','Intermediate','Lower your torso from the knees and curl back up using your hamstrings.'],
  ['Barbell hip thrust','Glutes','Barbell and bench','Beginner','Rest your upper back on a bench and drive your hips up, squeezing your glutes.'],
  ['Single-leg glute bridge','Glutes','Bodyweight','Beginner','Press through one heel to raise your hips while keeping them level.'],
  ['Cable glute kickback','Glutes','Cable','Beginner','Extend one leg back against the cable while keeping your torso steady.'],
  ['Hip abduction machine','Glutes','Hip abduction machine','Beginner','Press your knees outward against the pads, then return slowly.'],
  ['Banded lateral walk','Glutes','Resistance band','Beginner','Keep tension on the band and take small controlled steps sideways.'],
  ['Sumo squat','Glutes','Dumbbell or kettlebell','Beginner','Stand with a wide stance and squat down while keeping your knees aligned with your toes.'],
  ['Frog pump','Glutes','Bodyweight','Beginner','Lie with the soles of your feet together and lift your hips by squeezing your glutes.'],
  ['Clamshell','Glutes','Bodyweight or resistance band','Beginner','Lie on your side with knees bent and open the top knee while keeping your feet together.'],
  ['Standing calf raise','Calves','Machine or bodyweight','Beginner','Rise onto the balls of your feet, pause, then lower your heels slowly.'],
  ['Seated calf raise','Calves','Seated calf raise machine','Beginner','Raise your heels against the pad, pause, and lower through a comfortable range.'],
  ['Leg press calf raise','Calves','Leg press machine','Beginner','With knees softly bent, press through the balls of your feet and lower slowly.'],
  ['Single-leg calf raise','Calves','Bodyweight','Beginner','Rise onto one foot while holding support for balance, then lower slowly.'],
  ['Donkey calf raise','Calves','Donkey calf machine','Beginner','Keep your knees softly bent and raise and lower your heels with control.'],
  ['Wrist curl','Forearms','Dumbbell or barbell','Beginner','Rest your forearms and curl your wrists upward, then lower slowly.'],
  ['Reverse wrist curl','Forearms','Dumbbell or barbell','Beginner','Rest your forearms and raise the backs of your hands, then lower slowly.'],
  ['Wrist roller','Forearms','Wrist roller','Beginner','Wind the weighted roller up and down using controlled wrist turns.'],
  ['Farmer carry','Forearms','Dumbbell or kettlebell','Beginner','Walk steadily while carrying weights at your sides with an upright posture.'],
  ['Dead hang','Forearms','Pull-up bar','Beginner','Hang from a secure bar for a comfortable duration while keeping your shoulders active.'],
  ['Kettlebell swing','Full Body','Kettlebell','Intermediate','Hinge at the hips and swing the kettlebell using a strong hip drive.'],
  ['Burpee','Full Body','Bodyweight','Intermediate','Lower your hands, step or jump back, return to standing, and reach overhead.'],
  ['Dumbbell thruster','Full Body','Dumbbell','Intermediate','Stand from a squat and press the dumbbells overhead in one smooth motion.'],
  ['Turkish get-up','Full Body','Kettlebell','Advanced','Move from the floor to standing while keeping the weight steady overhead.'],
  ['Clean and press','Full Body','Barbell or dumbbell','Advanced','Lift the weight to shoulder height, stabilize, then press overhead.'],
  ['Sled push','Full Body','Weighted sled','Beginner','Push the sled forward in short steady steps while keeping your torso braced.']
];
const insertExercise = db.prepare('INSERT OR IGNORE INTO exercises(name,muscle_group,equipment,difficulty,instructions) VALUES(?,?,?,?,?)');
for (const row of [...exerciseSeeds,...additionalExerciseSeeds]) insertExercise.run(...row);
db.prepare("UPDATE exercises SET muscle_group='Biceps' WHERE name='Bicep curl'").run();
db.prepare("UPDATE exercises SET muscle_group='Quads' WHERE name IN ('Goblet squat','Lunge')").run();
db.prepare("UPDATE exercises SET muscle_group='Hamstrings' WHERE name='Romanian deadlift'").run();

const mimeTypes = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml' };
const json = (res, status, payload, headers = {}) => { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...headers }); res.end(JSON.stringify(payload)); };
const escapeHtml = value => String(value ?? '').replace(/[&<>\"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch]));
function htmlResponse(res,status,title,body){res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} - Fitpath</title><body style="margin:0;background:#f5f6f2;color:#263a35;font:16px Arial,sans-serif;display:grid;min-height:100vh;place-items:center"><main style="max-width:520px;margin:24px;padding:36px;background:white;border:1px solid #e9ece6;border-radius:16px"><p style="color:#315f4d;font-weight:bold">FITPATH</p><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`);}
function readBody(req) { return new Promise((resolve, reject) => { let body=''; req.on('data', chunk => { body += chunk; if (body.length > 64_000) req.destroy(); }); req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new ValidationError('Send valid JSON.')); } }); req.on('error', reject); }); }
function hashPassword(password, salt) { return crypto.scryptSync(password, salt, 64).toString('hex'); }
function cookieToken(req) { const match = (req.headers.cookie || '').match(/(?:^|;\s*)fitpath_session=([^;]+)/); return match ? decodeURIComponent(match[1]) : ''; }
function currentUser(req) {
  const token = cookieToken(req); if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const row = db.prepare('SELECT users.id, users.name, users.email, users.role, users.steps_goal, users.calories_goal, users.gender, users.height_cm, users.weight_kg, users.bmi FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?').get(tokenHash, Date.now());
  if (row) db.prepare('UPDATE users SET last_active_at=? WHERE id=?').run(new Date().toISOString(), row.id);
  return row || null;
}
const requireAuth = (req,res) => { const user = currentUser(req); if (!user) { json(res,401,{error:'Please sign in to continue.'}); return null; } return user; };
function validDate(s) { if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(`${s}T00:00:00Z`);return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===s; }
function isAtLeast18(birthDate) {
  const birth=new Date(`${birthDate}T00:00:00Z`),now=new Date();
  let age=now.getUTCFullYear()-birth.getUTCFullYear();
  if(now.getUTCMonth()<birth.getUTCMonth()||(now.getUTCMonth()===birth.getUTCMonth()&&now.getUTCDate()<birth.getUTCDate()))age--;
  return age>=18;
}
function number(value, min, max, label, optional = false) {
  if ((value === '' || value == null) && optional) return null;
  const n = Number(value); if (!Number.isFinite(n) || n < min || n > max) throw new ValidationError(`${label} must be between ${min} and ${max}.`); return n;
}
function isValidEmailAddress(value) {
  const email=String(value??'');
  if(email.length>254)return false;
  const at=email.lastIndexOf('@');
  if(at<1||at!==email.indexOf('@'))return false;
  const local=email.slice(0,at),domain=email.slice(at+1);
  if(local.length>64||! /^[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+(?:\.[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+)*$/u.test(local))return false;
  if(domain.length>253)return false;
  const labels=domain.split('.');
  const labelPattern=/^[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?$/u;
  return labels.length>=2&&labels.every(label=>label.length<=63&&labelPattern.test(label))&&labels.at(-1).length>=2&&/[\p{L}]/u.test(labels.at(-1));
}
function activityDuration(value, unit) {
  const durationUnit=['minutes','hours'].includes(unit)?unit:'minutes';
  const raw=number(value,durationUnit==='hours'?0.0167:1,durationUnit==='hours'?24:1440,'Duration');
  const minutes=durationUnit==='hours'?raw*60:raw;
  if(minutes<1||minutes>1440)throw new ValidationError('Duration must be between 1 minute and 24 hours.');
  return {value:Number(minutes.toFixed(4)),unit:durationUnit};
}
function activityDistance(value, unit) {
  const distanceUnit=['km','m','mi'].includes(unit)?unit:'km';
  const limits={km:2000,m:2000000,mi:1242.742};
  const raw=number(value,0,limits[distanceUnit],'Distance',true);
  const km=raw===null?null:distanceUnit==='m'?raw/1000:distanceUnit==='mi'?raw*1.609344:raw;
  return {value:km===null?null:Number(km.toFixed(6)),unit:distanceUnit};
}
function string(value, max, label, optional = false) { const s = String(value ?? '').trim(); if (!s && optional) return ''; if (!s || s.length > max) throw new ValidationError(`${label} is required and must be under ${max} characters.`); return s; }
const today = () => new Date().toISOString().slice(0,10);
function localTimestamp(date = today()) { return `${date}T${new Date().toISOString().slice(11,19)}Z`; }
function safeRecordDelete(table, userId, id) {
  const allowed = { activities:'activities', food:'food_logs', body:'body_metrics', sleep:'sleep_logs', goal:'goals' };
  const target = allowed[table]; if (!target) return false;
  const field = table === 'sleep' ? 'sleep_date' : 'logged_at';
  return db.prepare(`DELETE FROM ${target} WHERE id=? AND user_id=?`).run(Number(id), userId).changes > 0;
}
function listLogs(userId, fromDate, toDate) {
  const from = `${fromDate}T00:00:00.000Z`, to = `${toDate}T23:59:59.999Z`;
  const activities = db.prepare(`SELECT *,CASE duration_unit WHEN 'hours' THEN duration_min/60.0 ELSE duration_min END AS duration_value,CASE distance_unit WHEN 'm' THEN distance_km*1000.0 WHEN 'mi' THEN distance_km/1.609344 ELSE distance_km END AS distance_value FROM activities WHERE user_id=? AND activity_date BETWEEN ? AND ? ORDER BY activity_date DESC,id DESC`).all(userId, fromDate, toDate);
  const meals = db.prepare(`SELECT fl.id,fl.food_id,fl.meal,fl.servings,fl.logged_at,f.name,f.serving,f.calories,f.protein,f.carbs,f.fat FROM food_logs fl JOIN foods f ON f.id=fl.food_id WHERE fl.user_id=? AND fl.logged_at BETWEEN ? AND ? ORDER BY fl.logged_at DESC`).all(userId,from,to);
  const body = db.prepare('SELECT * FROM body_metrics WHERE user_id=? AND logged_at BETWEEN ? AND ? ORDER BY logged_at DESC').all(userId,from,to);
  const sleep = db.prepare('SELECT * FROM sleep_logs WHERE user_id=? AND sleep_date BETWEEN ? AND ? ORDER BY sleep_date DESC').all(userId,fromDate,toDate);
  const workouts = db.prepare(`SELECT ws.id,ws.user_id,ws.title,ws.workout_date,ws.notes,count(wset.id) AS set_count,coalesce(sum(wset.reps),0) AS total_reps FROM workout_sessions ws LEFT JOIN workout_sets wset ON wset.session_id=ws.id WHERE ws.user_id=? AND ws.workout_date BETWEEN ? AND ? GROUP BY ws.id ORDER BY ws.workout_date DESC,ws.id DESC`).all(userId,fromDate,toDate);
  const workoutSets=db.prepare(`SELECT wset.session_id,wset.exercise_id,wset.reps,wset.weight_kg FROM workout_sets wset JOIN workout_sessions ws ON ws.id=wset.session_id WHERE ws.user_id=? AND ws.workout_date BETWEEN ? AND ? ORDER BY ws.workout_date DESC,ws.id DESC,wset.set_no`).all(userId,fromDate,toDate);
  const setsByWorkout=new Map();for(const set of workoutSets){if(!setsByWorkout.has(set.session_id))setsByWorkout.set(set.session_id,[]);setsByWorkout.get(set.session_id).push(set);}
  const workoutsWithSets=workouts.map(workout=>({...workout,sets:setsByWorkout.get(workout.id)||[]}));
  const goals = db.prepare('SELECT * FROM goals WHERE user_id=? ORDER BY id DESC').all(userId);
  return { activities, meals, body, sleep, workouts:workoutsWithSets, goals };
}
async function handle(req,res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const route = url.pathname;
  const unsafe = !['GET','HEAD','OPTIONS'].includes(req.method);
  if (unsafe && req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return json(res,403,{error:'Request origin was rejected.'});
  try {
    if (route.startsWith('/api/')) {
      if (route === '/api/register' && req.method === 'POST') {
        const body=await readBody(req);const name=string(body.name,80,'Name');if(!/^[\p{L}]+(?: +[\p{L}]+)*$/u.test(name))return json(res,400,{error:'Your name can contain letters and spaces only.'});const birthDate=String(body.birth_date??'');if(!validDate(birthDate))return json(res,400,{error:'Enter a valid date of birth.'});if(!isAtLeast18(birthDate))return json(res,400,{error:'You must be at least 18 to create an account.'});const email=string(body.email,254,'Email').toLowerCase();
        if(!isValidEmailAddress(email))return json(res,400,{error:'Enter a valid email address, such as name@example.com.'});
        if(typeof body.password!=='string'||body.password.length<10||body.password.length>200)return json(res,400,{error:'Password must be at least 10 characters.'});
        if(body.password!==body.confirm_password)return json(res,400,{error:'Passwords do not match.'});
        const gender=string(body.gender,40,'Gender');if(!['Female','Male','Non-binary','Prefer not to say'].includes(gender))return json(res,400,{error:'Choose a gender option.'});
        const heightText=String(body.height_cm??''),weightText=String(body.weight_kg??'');if(!/^\d+(?:\.\d+)?$/.test(heightText)||!/^\d+(?:\.\d+)?$/.test(weightText))return json(res,400,{error:'Enter height and weight using numbers only.'});const height=number(heightText,100,250,'Height'),weight=number(weightText,20,500,'Weight');const bmi=Number((weight/((height/100)**2)).toFixed(1));
        const salt=crypto.randomBytes(16).toString('hex');let userId;
        try{const result=db.prepare('INSERT INTO users(name,email,salt,password_hash,gender,height_cm,weight_kg,bmi,birth_date) VALUES(?,?,?,?,?,?,?,?,?)').run(name,email,salt,hashPassword(body.password,salt),gender,height,weight,bmi,birthDate);userId=Number(result.lastInsertRowid);}catch(error){if(String(error.message).includes('UNIQUE'))return json(res,409,{error:'An account with that email already exists.'});throw error;}
        const user=db.prepare('SELECT id,name,email,role,steps_goal,calories_goal,gender,height_cm,weight_kg,bmi FROM users WHERE id=?').get(userId);
        return json(res,201,{user});
      }
      if (route === '/api/login' && req.method === 'POST') {
        const body = await readBody(req); const email = String(body.email || '').trim().toLowerCase(); const row = db.prepare('SELECT * FROM users WHERE email=?').get(email);
        if (!row || typeof body.password !== 'string' || !crypto.timingSafeEqual(Buffer.from(hashPassword(body.password,row?.salt || 'fitpath-dummy')),Buffer.from(row?.password_hash || hashPassword('invalid','fitpath-dummy')))) return json(res,401,{error:'Email or password is incorrect.'});
        const token = crypto.randomBytes(32).toString('base64url'); const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(tokenHash,row.id,Date.now()+30*86400000);
        db.prepare('UPDATE users SET last_active_at=? WHERE id=?').run(new Date().toISOString(),row.id);
        const user = db.prepare('SELECT id,name,email,role,steps_goal,calories_goal,gender,height_cm,weight_kg,bmi FROM users WHERE id=?').get(row.id);
        return json(res,200,{user},{'Set-Cookie':`fitpath_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${SECURE_COOKIE}`});
      }
      if (route === '/api/logout' && req.method === 'POST') {
        const token = cookieToken(req); if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(crypto.createHash('sha256').update(token).digest('hex'));
        return json(res,200,{ok:true},{'Set-Cookie':`fitpath_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${SECURE_COOKIE}`});
      }
      if (route === '/api/me' && req.method === 'GET') return json(res,200,{user:currentUser(req)});
      const user = requireAuth(req,res); if (!user) return;
      if (route === '/api/profile' && req.method === 'PATCH') {
        const b=await readBody(req); const name=string(b.name,80,'Name'); const steps_goal=number(b.steps_goal,500,100000,'Step goal'); const calories_goal=number(b.calories_goal,500,10000,'Calorie goal');
        db.prepare('UPDATE users SET name=?,steps_goal=?,calories_goal=? WHERE id=?').run(name,steps_goal,calories_goal,user.id);
        return json(res,200,{user:db.prepare('SELECT id,name,email,role,steps_goal,calories_goal,gender,height_cm,weight_kg,bmi FROM users WHERE id=?').get(user.id)});
      }
      if (route === '/api/account' && req.method === 'DELETE') {
        const b=await readBody(req); const row=db.prepare('SELECT salt,password_hash FROM users WHERE id=?').get(user.id);
        if (!row || !b.password || !crypto.timingSafeEqual(Buffer.from(hashPassword(b.password,row.salt)),Buffer.from(row.password_hash))) return json(res,401,{error:'Enter your current password to delete your account.'});
        db.prepare('DELETE FROM users WHERE id=?').run(user.id); return json(res,200,{ok:true},{'Set-Cookie':`fitpath_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${SECURE_COOKIE}`});
      }
      if (route === '/api/catalog' && req.method === 'GET') return json(res,200,{foods:db.prepare('SELECT * FROM foods ORDER BY category,name').all(),exercises:db.prepare('SELECT * FROM exercises ORDER BY muscle_group,name').all()});
      if (route === '/api/summary' && req.method === 'GET') {
        const date=validDate(url.searchParams.get('date'))?url.searchParams.get('date'):today();
        const from = new Date(`${date}T00:00:00Z`); from.setUTCDate(from.getUTCDate()-6); const start=from.toISOString().slice(0,10);
        const act=db.prepare('SELECT count(*) count,coalesce(sum(duration_min),0) minutes,coalesce(sum(distance_km),0) distance,coalesce(sum(steps),0) steps FROM activities WHERE user_id=? AND activity_date=?').get(user.id,date);
        const nutrition=db.prepare(`SELECT coalesce(sum(fl.servings*f.calories),0) calories,coalesce(sum(fl.servings*f.protein),0) protein,coalesce(sum(fl.servings*f.carbs),0) carbs,coalesce(sum(fl.servings*f.fat),0) fat FROM food_logs fl JOIN foods f ON f.id=fl.food_id WHERE fl.user_id=? AND fl.logged_at BETWEEN ? AND ?`).get(user.id,`${date}T00:00:00.000Z`,`${date}T23:59:59.999Z`);
        const weight=db.prepare('SELECT weight_kg,logged_at FROM body_metrics WHERE user_id=? ORDER BY logged_at DESC LIMIT 1').get(user.id) || null;
        const week=db.prepare(`SELECT activity_date date,coalesce(sum(duration_min),0) minutes,coalesce(sum(steps),0) steps FROM activities WHERE user_id=? AND activity_date BETWEEN ? AND ? GROUP BY activity_date ORDER BY activity_date`).all(user.id,start,date);
        const recent=db.prepare(`SELECT id,activity_type,activity_date,duration_min,duration_unit,CASE duration_unit WHEN 'hours' THEN duration_min/60.0 ELSE duration_min END AS duration_value,distance_km,distance_unit,CASE distance_unit WHEN 'm' THEN distance_km*1000.0 WHEN 'mi' THEN distance_km/1.609344 ELSE distance_km END AS distance_value,intensity FROM activities WHERE user_id=? ORDER BY activity_date DESC,id DESC LIMIT 5`).all(user.id);
        const sessions=db.prepare('SELECT count(*) count FROM workout_sessions WHERE user_id=? AND workout_date BETWEEN ? AND ?').get(user.id,start,date).count;
        return json(res,200,{date,user,activity:act,nutrition,weight,week,recent,workout_sessions:sessions});
      }
      if (route === '/api/logs' && req.method === 'GET') {
        const date=validDate(url.searchParams.get('date'))?url.searchParams.get('date'):today(); const d=new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate()-30);
        return json(res,200,listLogs(user.id,d.toISOString().slice(0,10),date));
      }
      if (route === '/api/activities' && req.method === 'POST') {
        const b=await readBody(req); if (!validDate(b.date)) throw new ValidationError('Choose a valid activity date.');
        const type=b.type==='Other'?`Other: ${string(b.other_activity,33,'Activity description')}`:string(b.type,40,'Activity'); const duration=activityDuration(b.duration,b.duration_unit); const distance=activityDistance(b.distance,b.distance_unit); const steps=number(b.steps,0,200000,'Steps',true);
        const intensity=['Easy','Moderate','Hard'].includes(b.intensity)?b.intensity:'Moderate'; const notes=string(b.notes,500,'Notes',true);
        db.prepare('INSERT INTO activities(user_id,activity_type,activity_date,duration_min,duration_unit,distance_km,distance_unit,steps,intensity,notes) VALUES(?,?,?,?,?,?,?,?,?,?)').run(user.id,type,b.date,duration.value,duration.unit,distance.value,distance.unit,steps,intensity,notes);
        return json(res,201,{ok:true});
      }
      if (route === '/api/food-logs' && req.method === 'POST') {
        const b=await readBody(req); const foodId=number(b.food_id,1,1000000,'Food'); const servings=number(b.servings,0.05,50,'Servings'); const meal=['Breakfast','Lunch','Dinner','Snack'].includes(b.meal)?b.meal:'Snack'; const date=validDate(b.date)?b.date:today();
        const food=db.prepare('SELECT id FROM foods WHERE id=?').get(foodId); if (!food) throw new ValidationError('Choose a food from the list.');
        db.prepare('INSERT INTO food_logs(user_id,food_id,meal,servings,logged_at) VALUES(?,?,?,?,?)').run(user.id,foodId,meal,servings,localTimestamp(date)); return json(res,201,{ok:true});
      }
      if (route === '/api/body-metrics' && req.method === 'POST') {
        const b=await readBody(req); const weight=number(b.weight_kg,20,500,'Weight'); const waist=number(b.waist_cm,20,300,'Waist',true); const hip=number(b.hip_cm,20,300,'Hip',true); const date=validDate(b.date)?b.date:today();
        db.prepare('INSERT INTO body_metrics(user_id,weight_kg,waist_cm,hip_cm,logged_at) VALUES(?,?,?,?,?)').run(user.id,weight,waist,hip,localTimestamp(date)); return json(res,201,{ok:true});
      }
      if (route === '/api/sleep-logs' && req.method === 'POST') {
        const b=await readBody(req); if (!validDate(b.date)) throw new ValidationError('Choose a valid sleep date.');
        const bedtime=string(b.bedtime,5,'Bedtime'),waketime=string(b.waketime,5,'Wake time'); if (!/^\d{2}:\d{2}$/.test(bedtime)||!/^\d{2}:\d{2}$/.test(waketime)) throw new ValidationError('Enter valid bed and wake times.');
        const quality=number(b.quality,1,5,'Sleep quality'),energy=number(b.energy,1,5,'Energy'); const notes=string(b.notes,500,'Notes',true);
        db.prepare('INSERT INTO sleep_logs(user_id,sleep_date,bedtime,waketime,quality,energy,notes) VALUES(?,?,?,?,?,?,?)').run(user.id,b.date,bedtime,waketime,quality,energy,notes); return json(res,201,{ok:true});
      }
      if (route === '/api/goals' && req.method === 'POST') {
        const b=await readBody(req); const title=string(b.title,100,'Goal'); const metric=['activity_minutes','weight_kg','workout_sessions'].includes(b.metric)?b.metric:'activity_minutes'; const target=number(b.target,1,100000,'Target'); const unit=string(b.unit||'min',20,'Unit'); const deadline=b.deadline&&validDate(b.deadline)?b.deadline:null;
        db.prepare('INSERT INTO goals(user_id,title,metric,target,unit,deadline) VALUES(?,?,?,?,?,?)').run(user.id,title,metric,target,unit,deadline); return json(res,201,{ok:true});
      }
      if (route === '/api/workouts' && req.method === 'POST') {
        const b=await readBody(req); const title=string(b.title,100,'Workout'); const date=validDate(b.date)?b.date:today(); const notes=string(b.notes,500,'Notes',true);
        const sets=Array.isArray(b.sets)?b.sets.slice(0,100):[]; if (!sets.length) throw new ValidationError('Add at least one exercise set.');
        const add=db.prepare('INSERT INTO workout_sessions(user_id,title,workout_date,notes) VALUES(?,?,?,?)');
        const addSet=db.prepare('INSERT INTO workout_sets(session_id,exercise_id,set_no,reps,weight_kg,duration_sec,notes) VALUES(?,?,?,?,?,?,?)');
        db.exec('BEGIN IMMEDIATE'); try { const result=add.run(user.id,title,date,notes); sets.forEach((s,i)=>{const eid=number(s.exercise_id,1,1000000,'Exercise');if(!db.prepare('SELECT id FROM exercises WHERE id=?').get(eid))throw new ValidationError('Choose a listed exercise.');addSet.run(result.lastInsertRowid,eid,i+1,number(s.reps,1,10000,'Reps'),number(s.weight_kg,0,2000,'Weight',true),number(s.duration_sec,0,86400,'Set duration',true),string(s.notes,250,'Set notes',true));});db.exec('COMMIT');} catch(e){db.exec('ROLLBACK');throw e;} return json(res,201,{ok:true});
      }
      const editMatch=route.match(/^\/api\/edit\/(activity|food|body|sleep|goal|workout)\/(\d+)$/);
      if(editMatch&&req.method==='PATCH'){
        const [,kind,idText]=editMatch,id=Number(idText),b=await readBody(req);
        const table={activity:'activities',food:'food_logs',body:'body_metrics',sleep:'sleep_logs',goal:'goals',workout:'workout_sessions'}[kind];
        if(!db.prepare(`SELECT id FROM ${table} WHERE id=? AND user_id=?`).get(id,user.id))return json(res,404,{error:'Record not found.'});
        if(kind==='activity'){
          if(!validDate(b.date))throw new ValidationError('Choose a valid activity date.');const type=b.type==='Other'?`Other: ${string(b.other_activity,33,'Activity description')}`:string(b.type,40,'Activity'),duration=activityDuration(b.duration,b.duration_unit),distance=activityDistance(b.distance,b.distance_unit),steps=number(b.steps,0,200000,'Steps',true),intensity=['Easy','Moderate','Hard'].includes(b.intensity)?b.intensity:'Moderate',notes=string(b.notes,500,'Notes',true);
          db.prepare('UPDATE activities SET activity_type=?,activity_date=?,duration_min=?,duration_unit=?,distance_km=?,distance_unit=?,steps=?,intensity=?,notes=? WHERE id=? AND user_id=?').run(type,b.date,duration.value,duration.unit,distance.value,distance.unit,steps,intensity,notes,id,user.id);
        }else if(kind==='food'){
          const foodId=number(b.food_id,1,1000000,'Food'),servings=number(b.servings,0.05,50,'Servings'),meal=['Breakfast','Lunch','Dinner','Snack'].includes(b.meal)?b.meal:'Snack',date=validDate(b.date)?b.date:today();if(!db.prepare('SELECT id FROM foods WHERE id=?').get(foodId))throw new ValidationError('Choose a food from the list.');
          db.prepare('UPDATE food_logs SET food_id=?,meal=?,servings=?,logged_at=? WHERE id=? AND user_id=?').run(foodId,meal,servings,localTimestamp(date),id,user.id);
        }else if(kind==='body'){
          const weight=number(b.weight_kg,20,500,'Weight'),waist=number(b.waist_cm,20,300,'Waist',true),hip=number(b.hip_cm,20,300,'Hip',true),date=validDate(b.date)?b.date:today();db.prepare('UPDATE body_metrics SET weight_kg=?,waist_cm=?,hip_cm=?,logged_at=? WHERE id=? AND user_id=?').run(weight,waist,hip,localTimestamp(date),id,user.id);
        }else if(kind==='sleep'){
          if(!validDate(b.date))throw new ValidationError('Choose a valid sleep date.');const bedtime=string(b.bedtime,5,'Bedtime'),waketime=string(b.waketime,5,'Wake time');if(!/^\d{2}:\d{2}$/.test(bedtime)||!/^[0-2]\d:[0-5]\d$/.test(waketime)||!/^[0-2]\d:[0-5]\d$/.test(bedtime))throw new ValidationError('Enter valid bed and wake times.');const quality=number(b.quality,1,5,'Sleep quality'),energy=number(b.energy,1,5,'Energy'),notes=string(b.notes,500,'Notes',true);db.prepare('UPDATE sleep_logs SET sleep_date=?,bedtime=?,waketime=?,quality=?,energy=?,notes=? WHERE id=? AND user_id=?').run(b.date,bedtime,waketime,quality,energy,notes,id,user.id);
        }else if(kind==='goal'){
          const title=string(b.title,100,'Goal'),metric=['activity_minutes','weight_kg','workout_sessions'].includes(b.metric)?b.metric:'activity_minutes',target=number(b.target,1,100000,'Target'),unit=string(b.unit||'min',20,'Unit'),deadline=b.deadline&&validDate(b.deadline)?b.deadline:null;db.prepare('UPDATE goals SET title=?,metric=?,target=?,unit=?,deadline=? WHERE id=? AND user_id=?').run(title,metric,target,unit,deadline,id,user.id);
        }else{
          const title=string(b.title,100,'Workout'),date=validDate(b.date)?b.date:today(),notes=string(b.notes,500,'Notes',true),sets=Array.isArray(b.sets)?b.sets.slice(0,100):[];
          if(!sets.length)throw new ValidationError('Add at least one exercise set.');
          const addSet=db.prepare('INSERT INTO workout_sets(session_id,exercise_id,set_no,reps,weight_kg,duration_sec,notes) VALUES(?,?,?,?,?,?,?)');
          db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE workout_sessions SET title=?,workout_date=?,notes=? WHERE id=? AND user_id=?').run(title,date,notes,id,user.id);db.prepare('DELETE FROM workout_sets WHERE session_id=?').run(id);sets.forEach((set,index)=>{const exerciseId=number(set.exercise_id,1,1000000,'Exercise');if(!db.prepare('SELECT id FROM exercises WHERE id=?').get(exerciseId))throw new ValidationError('Choose a listed exercise.');addSet.run(id,exerciseId,index+1,number(set.reps,1,10000,'Reps'),number(set.weight_kg,0,2000,'Weight',true),null,'');});db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
        }
        return json(res,200,{ok:true});
      }
      const delMatch=route.match(/^\/api\/delete\/(activity|food|body|sleep|goal)\/(\d+)$/);
      if (delMatch && req.method === 'DELETE') return safeRecordDelete(delMatch[1],user.id,delMatch[2])?json(res,200,{ok:true}):json(res,404,{error:'Record not found.'});
      const workoutDelete=route.match(/^\/api\/workouts\/(\d+)$/);
      if (workoutDelete && req.method==='DELETE') { const result=db.prepare('DELETE FROM workout_sessions WHERE id=? AND user_id=?').run(Number(workoutDelete[1]),user.id);return result.changes?json(res,200,{ok:true}):json(res,404,{error:'Workout not found.'}); }
      if (route === '/api/admin/users' && req.method==='GET') {
        if (user.role!=='admin') return json(res,403,{error:'Administrator access required.'});
        const users = db.prepare(
          'SELECT u.id,u.name,u.email,u.role,u.created_at,u.last_active_at,u.gender,u.height_cm,u.weight_kg,u.bmi,u.steps_goal,u.calories_goal,' +
          '(SELECT count(*) FROM activities a WHERE a.user_id=u.id) AS activity_count,' +
          '(SELECT count(*) FROM workout_sessions w WHERE w.user_id=u.id) AS workout_count ' +
          'FROM users u ORDER BY u.id DESC'
        ).all();
        return json(res,200,{users});
      }
      if (route === '/api/admin/actions' && req.method==='GET') {
        if (user.role!=='admin') return json(res,403,{error:'Administrator access required.'});
        return json(res,200,{actions:db.prepare('SELECT id,admin_email,action,target_user_id,created_at FROM admin_actions ORDER BY id DESC LIMIT 50').all()});
      }
      const adminDelete = route.match(/^\/api\/admin\/users\/(\d+)$/);
      if (adminDelete && req.method === 'DELETE') {
        if (user.role !== 'admin') return json(res,403,{error:'Administrator access required.'});
        const targetId = Number(adminDelete[1]);
        if (!Number.isSafeInteger(targetId) || targetId < 1) return json(res,400,{error:'Invalid account ID.'});
        if (targetId === user.id) return json(res,400,{error:'You cannot delete your own admin account.'});
        const target = db.prepare('SELECT id,role FROM users WHERE id=?').get(targetId);
        if (!target) return json(res,404,{error:'Account not found.'});
        if (target.role === 'admin') return json(res,403,{error:'Admin accounts cannot be deleted here.'});
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('INSERT INTO admin_actions(admin_user_id,admin_email,action,target_user_id) VALUES(?,?,?,?)').run(user.id,user.email,'delete_account',targetId);
          db.prepare('DELETE FROM users WHERE id=?').run(targetId);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return json(res,200,{ok:true});
      }
      if (route === '/api/admin/summary' && req.method==='GET') {
        if (user.role!=='admin') return json(res,403,{error:'Administrator access required.'});
        return json(res,200,{users:db.prepare('SELECT count(*) count FROM users').get().count,activity_logs:db.prepare('SELECT count(*) count FROM activities').get().count,workouts:db.prepare('SELECT count(*) count FROM workout_sessions').get().count});
      }
      return json(res,404,{error:'API route not found.'});
    }
    const pathname = route === '/' ? '/index.html' : (route === '/admin' || route === '/admin/' ? '/admin.html' : route);
    const resolved = path.resolve(ROOT, `.${pathname}`);
    if (!resolved.startsWith(ROOT + path.sep)) return json(res,403,{error:'Not found.'});
    fs.readFile(resolved,(err,content)=>{ if(err)return json(res,404,{error:'Page not found.'}); res.writeHead(200,{'Content-Type':mimeTypes[path.extname(resolved)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"});res.end(content); });
  } catch (error) { json(res,error instanceof ValidationError?400:500,{error:error instanceof ValidationError?error.message:'Something went wrong. Please try again.'}); }
}

const server = http.createServer((req,res)=>{ Promise.resolve(handle(req,res)).catch(()=>json(res,500,{error:'Something went wrong. Please try again.'})); });
server.listen(PORT,'0.0.0.0',()=>console.log(`Fitpath running at http://localhost:${PORT}`));
process.on('SIGINT',()=>{db.close();server.close(()=>process.exit(0));});
