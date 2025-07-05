# 📱 WhatsApp Calendar Audit Service

**Smart WhatsApp integration that prevents double-booking and missed meetings by monitoring WhatsApp conversations and cross-referencing with Google Calendar.**

![Docker](https://img.shields.io/badge/Docker-Ready-blue)
![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![License](https://img.shields.io/badge/License-MIT-yellow)

## ✨ Features

- **🎯 Smart Notifications**: Only alerts for actual conflicts or missing events (no spam!)
- **👥 Multi-User Support**: Easy onboarding for family members without technical setup
- **⚡ Real-Time Processing**: Webhook-based, no rate limiting issues
- **🔒 Privacy First**: Messages processed locally, minimal data storage
- **🚀 Easy Setup**: No Google Cloud project needed for new users
- **🐳 Docker Ready**: One-command deployment

## 🎯 How It Works

### Smart Detection Logic
- ✅ **AI-Powered Analysis**: Claude LLM understands conversation context
- ✅ **Casual Message Detection**: Recognizes "ok were set for tomorrow" type confirmations
- ✅ **Hebrew/English Keywords**: Comprehensive meeting vocabulary
- ✅ **Context-Aware**: Analyzes conversation history for complete meeting details
- ✅ **Smart Calendar Queries**: Only checks relevant dates mentioned in messages
- ✅ Only notifies for ACTUAL issues:
  - Schedule conflicts with existing events
  - Missing meetings that should be on calendar
- ❌ No notifications for meetings already properly scheduled

### Example Scenarios

**🤖 AI Context Understanding**
```
Message 1: "Can we meet tomorrow?"
Message 2: "How about 3 PM?"
Message 3: "ok were set for tomorrow"
AI Analysis: Extracts "Tomorrow 3 PM meeting" from conversation
→ Calendar checked for conflicts
```

**🚨 Conflict Detection**
```
WhatsApp: "Meeting tomorrow at 3 PM with Sarah"
Calendar: Already has "Doctor appointment 2:30-4:00 PM"
→ CONFLICT ALERT sent
```

**📅 Missing Event**
```
WhatsApp: "Dinner meeting Friday 7 PM with clients"
Calendar: No events found for Friday evening
→ MISSING EVENT alert sent
```

**✅ Already Scheduled**
```
WhatsApp: "Reminder: team meeting at 10 AM"
Calendar: "Team Standup 10:00-10:30 AM" exists
→ No notification (already handled)
```

## 🚀 Quick Start

### Prerequisites
- Docker and Docker Compose
- Google OAuth2 credentials
- Green API account

### 1. Clone and Setup
```bash
git clone https://github.com/yourusername/whatsapp-calendar-audit.git
cd whatsapp-calendar-audit
cp .env.example .env
```

### 2. Configure Environment
Edit `.env` with your credentials:
```env
# Green API Configuration
GREEN_API_ID_INSTANCE=your_instance_id
GREEN_API_TOKEN_INSTANCE=your_token_instance

# Google OAuth Configuration
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# Your WhatsApp number
WHATSAPP_PHONE_NUMBER=972501234567
```

### 3. Start the Service
```bash
docker-compose up -d
```

### 4. Add Users
Open `http://localhost:3001` and follow the setup process for each family member.

## 👥 Adding Family Members

### For the Admin (You)
1. Set up your Google OAuth app
2. Add family members' emails as authorized users
3. Start the Docker service

### For Family Members (Wife, etc.)
1. Visit `http://localhost:3001`
2. Enter name and WhatsApp number
3. Set up their own Green API instance (5 minutes)
4. Connect their Google Calendar (1 click)
5. Done! Automatic monitoring starts

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   WhatsApp      │────│  Smart Webhook   │────│  Google         │
│   Messages      │    │  Service         │    │  Calendar       │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                       ┌──────────────────┐
                       │  User Dashboard  │
                       │  (Easy Setup)    │
                       └──────────────────┘
```

## 📁 Project Structure

```
whatsapp-calendar-audit/
├── docker-compose.yml          # Docker setup
├── Dockerfile                  # Container configuration
├── combined-service.js         # Main service (webhooks + web UI)
├── package.json               # Dependencies
├── .env.example               # Environment template
└── data/                      # User configurations (auto-created)
    └── users/                 # Individual user settings
```

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GREEN_API_ID_INSTANCE` | Your Green API instance ID | Yes |
| `GREEN_API_TOKEN_INSTANCE` | Your Green API token | Yes |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | Yes |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | Yes |
| `WHATSAPP_PHONE_NUMBER` | Your WhatsApp number | Yes |
| `ANTHROPIC_API_KEY` | Claude API key (optional) | No |

### Multi-User Setup

Each user gets:
- Individual webhook endpoint: `/webhook/{userId}`
- Personal Google Calendar access via OAuth
- Isolated message processing and notifications
- Custom notification preferences

## 🔒 Security & Privacy

- **Local Processing**: Messages analyzed locally, not sent to external services
- **Minimal Storage**: Only recent messages cached temporarily
- **User Isolation**: Each user's data completely separate
- **OAuth Security**: Standard Google OAuth flow for calendar access

## 🚀 Production Deployment

### Cloud Server
```bash
# On your cloud server
git clone https://github.com/yourusername/whatsapp-calendar-audit.git
cd whatsapp-calendar-audit
# Edit .env with production URLs
docker-compose up -d
```

### Local with Public Access
```bash
# Terminal 1: Start service
docker-compose up

# Terminal 2: Expose via ngrok
ngrok http 3001
# Update webhook URLs to use ngrok URL
```

## 📊 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | User setup web interface |
| `/webhook` | POST | Default webhook for messages |
| `/webhook/:userId` | POST | User-specific webhook |
| `/health` | GET | Service health check |
| `/setup` | POST | User registration |
| `/auth/google/:userId` | GET | Google OAuth flow |

## 🛠️ Development

### Local Development
```bash
npm install
npm run dev
```

### Adding Features
- Edit `combined-service.js` for core functionality
- Update webhook processing in `handleWebhook()` function
- Modify user setup flow in the web interface routes

### Customizing Detection
- `keywords`: Add new meeting keywords
- `detectTimeAndDate()`: Enhance date/time parsing
- `handleWebhook()`: Adjust conflict logic

## 📊 Monitoring

- **Health Check**: `GET /health`
- **User Messages**: Check service logs
- **Docker Logs**: `docker logs whatsapp-calendar-audit`
- **Manual Testing**: Send WhatsApp messages with meeting keywords

## 🤝 Multi-User Benefits

- **No Technical Knowledge Required**: Family members just follow web setup
- **Shared Infrastructure**: One service serves all users
- **Individual Privacy**: Each user's messages and calendar separate
- **Easy Management**: Web interface shows all users and their status

## 🐛 Troubleshooting

### Common Issues

**Green API Rate Limiting**
- Solution: Service uses webhooks to avoid polling
- Check webhook configuration in Green API console

**Google OAuth Errors**
- Ensure redirect URI matches: `http://localhost:3001/auth/google/callback`
- Add user emails to authorized users in Google Cloud Console

**Docker Issues**
- Check logs: `docker logs whatsapp-calendar-audit`
- Restart: `docker-compose restart`
- Rebuild: `docker-compose build --no-cache`

### Support

- Check service health: `http://localhost:3001/health`
- View logs: `docker logs -f whatsapp-calendar-audit`
- Test webhook: Send WhatsApp message with "meeting" keyword

## 📄 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 🌟 Features Roadmap

- [x] **AI-powered meeting extraction** ✅ (Claude LLM integration)
- [x] **Context-aware conversation analysis** ✅
- [x] **Casual confirmation detection** ✅ (e.g., "ok were set")
- [x] **Smart calendar querying** ✅ (only relevant dates)
- [ ] Web dashboard for managing all users
- [ ] Advanced calendar conflict resolution
- [ ] Integration with more calendar providers
- [ ] Mobile app for easier setup
- [ ] Slack/Teams integration

---

**Perfect for families who want to avoid scheduling conflicts without technical complexity!**