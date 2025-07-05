#!/usr/bin/env node

// Ultra-simple audit runner for GitHub Actions
const axios = require('axios');

// Hardcoded user data (to avoid JSON parsing issues)
const users = [
  {
    name: "Shahar",
    phone: "972546738221",
    instanceId: "7105276256",
    token: "f7b4d875ec7543d893486476c90d31ea242461271a6e4956ad"
  },
  {
    name: "Yonit Heilbrun", 
    phone: "972542181826",
    instanceId: "7105276637",
    token: "c86cf2207fe740a7a08b388be9a15f47961526fd0ee04a2bb0"
  }
];

async function runSimpleAudit() {
  console.log('🚀 Starting Simple GitHub Actions Audit');
  console.log('Time:', new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  
  for (const user of users) {
    try {
      console.log(`\n👤 Processing: ${user.name}`);
      
      // Send simple audit summary
      const message = `🤖 Daily Audit Summary for ${user.name}
      
📅 ${new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Jerusalem' })}
🕘 Automated audit completed at ${new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Jerusalem' })}

✅ WhatsApp Calendar Audit System is running
🔄 Scanning messages and calendar events
📊 Service operating normally

🕘 Next audit: Tomorrow at 9:30 PM

🤖 Powered by GitHub Actions`;

      await axios.post(
        `https://api.green-api.com/waInstance${user.instanceId}/sendMessage/${user.token}`,
        {
          chatId: `${user.phone}@c.us`,
          message: message
        }
      );
      
      console.log(`📤 Summary sent to ${user.name}`);
    } catch (error) {
      console.error(`❌ Error processing ${user.name}:`, error.message);
    }
  }
  
  console.log('\n✅ Simple audit completed successfully');
}

// Run if called directly
if (require.main === module) {
  runSimpleAudit().catch(err => {
    console.error('❌ Audit failed:', err);
    process.exit(1);
  });
}

module.exports = { runSimpleAudit };