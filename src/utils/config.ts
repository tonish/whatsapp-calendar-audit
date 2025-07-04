import { Config } from '../types';

export const config: Config = {
  greenApi: {
    idInstance: process.env.GREEN_API_ID_INSTANCE || '',
    apiTokenInstance: process.env.GREEN_API_TOKEN_INSTANCE || '',
    baseUrl: process.env.GREEN_API_BASE_URL || 'https://api.green-api.com'
  },
  googleCalendar: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/callback',
    calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary'
  },
  keywords: {
    hebrew: [
      'פגישה', 'מפגש', 'פגישת', 'נפגש', 'להיפגש',
      'מינוי', 'תור', 'זמן', 'מחר', 'היום',
      'שעה', 'בוקר', 'צהריים', 'אחר הצהריים', 'ערב',
      'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת',
      'ביום', 'תאריך', 'מועד', 'נקבע', 'קובעים',
      'טיפול', 'אוסתאופתיה', 'אוסתאופטיה', 'כאב', 'גב'
    ],
    english: [
      'meeting', 'meet', 'appointment', 'schedule', 'planned',
      'today', 'tomorrow', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
      'morning', 'afternoon', 'evening', 'night', 'am', 'pm',
      'time', 'date', 'when', 'at', 'on', 'call',
    ]
  },
  database: {
    path: process.env.DATABASE_PATH || './data/audit.db'
  }
};

export const validateConfig = (): void => {
  const requiredEnvVars = [
    'GREEN_API_ID_INSTANCE',
    'GREEN_API_TOKEN_INSTANCE',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET'
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }
};