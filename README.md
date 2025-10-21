# Legal Process Search MVP

A comprehensive judicial process search system with AI-powered risk assessment for employee background checks (Know-Your-Employee).

## 🚀 Features

### Core Functionality
- 🔍 **Single Search**: Search judicial processes by name or CPF
- 📂 **Bulk Search**: Upload CSV files to search multiple CPFs at once
- 📋 **Process Details**: View complete case information, parties, lawyers, movements
- 💾 **Search History**: Automatic persistence of searches and process details
- 📊 **Statistics**: Aggregated insights across searches

### AI-Powered Risk Assessment
- 🤖 **Google Gemini Integration**: Advanced AI analysis of legal risk
- 🎯 **Multi-Factor Scoring**: 4-factor risk calculation (0-100 scale)
  - Process volume
  - Defendant role frequency
  - Case type severity
  - Financial exposure
- 📈 **Risk Levels**: Low / Medium / High / Critical classification
- 🚩 **Red Flags**: AI-identified specific concerns
- 💡 **Insights**: Context-aware employment recommendations
- 📥 **CSV Export**: Complete risk data in downloadable reports

### Technical Features
- 🏗️ **MVC Architecture**: Clean, maintainable code structure
- 🔐 **Authentication**: Secure user login system
- 📊 **Analytics**: Posthog integration for usage tracking
- 🎨 **Modern UI**: Streamlit-based responsive interface
- 🌐 **API Integration**: Predictus judicial process API

## 📋 Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Project Structure](#project-structure)
- [Usage](#usage)
- [Risk Assessment](#risk-assessment)
- [Development](#development)
- [Documentation](#documentation)
- [Contributing](#contributing)

## 🛠️ Installation

### Prerequisites
- Python 3.8+
- pip package manager
- Google Gemini API key (free tier available)

### Install Dependencies

```bash
# Clone the repository
git clone <repository-url>
cd mvp-sturdy-waddle

# Install required packages
pip install -r requirements.txt
```

### Required Packages
```
streamlit==1.48.1
requests==2.32.5
posthog==6.6.1
google-generativeai==0.8.3
pandas==2.2.3
python-dateutil==2.9.0.post0
```

## ⚡ Quick Start

### 1. Get API Keys

#### Google Gemini (Required for Risk Assessment)
1. Visit https://aistudio.google.com/app/apikey
2. Sign in with Google account
3. Click "Create API Key"
4. Copy your key

**Free Tier:** 1,500 requests/day, no credit card required

#### Predictus API (Required for Process Search)
Contact Predictus to obtain API credentials.

### 2. Configure Secrets

Create `.streamlit/secrets.toml`:

```toml
# Google Gemini - Risk Assessment
GEMINI_API_KEY = "your_gemini_api_key_here"
GEMINI_MODEL = "gemini-1.5-flash"

# Predictus API
PREDICTUS_USERNAME = "your_username"
PREDICTUS_PASSWORD = "your_password"

# Posthog Analytics (Optional)
POSTHOG_KEY = "your_posthog_key"
POSTHOG_HOST = "https://app.posthog.com"

# Application Users
[USUARIOS_APP]
"admin" = "admin123"
"user" = "user123"
```

### 3. Run the Application

```bash
streamlit run app.py
```

Visit http://localhost:8501 in your browser.

### 4. Login & Search

1. Login with configured credentials
2. Search by name or CPF
3. View results with risk assessment
4. Export data as needed

## ⚙️ Configuration

### Application Settings

Edit `config/settings.py`:

```python
# History Configuration
MAX_HISTORY_ITEMS = 50

# API Timeouts
REQUEST_TIMEOUT = 30

# File Upload Limits
MAX_FILE_SIZE_MB = 10
ALLOWED_FILE_TYPES = ['csv']
```

### Risk Assessment Configuration

Customize risk weights in `models/risk_assessment.py`:

```python
# Risk factor weights (must sum to 1.0)
WEIGHTS = {
    "process_count": 0.25,      # 25%
    "defendant_role": 0.30,     # 30%
    "case_severity": 0.25,      # 25%
    "financial_exposure": 0.20  # 20%
}

# Case severity scores (0-100)
CASE_SEVERITY = {
    "criminal": 100,
    "trabalhista": 70,
    "civil": 40,
    # Add custom case types...
}
```

### Gemini Model Options

Choose model in secrets.toml:

- `gemini-1.5-flash`: Fast, efficient (recommended)
- `gemini-1.5-pro`: Highest quality, slower
- `gemini-1.5-flash-8b`: Fastest, good for high volume

## 📁 Project Structure

```
mvp-sturdy-waddle/
├── app.py                      # Main application entry point
├── requirements.txt            # Python dependencies
│
├── config/                     # Configuration
│   └── settings.py            # App constants and settings
│
├── models/                     # Business Logic & Data
│   ├── analytics.py           # Posthog analytics
│   ├── auth.py                # Authentication
│   ├── predictus_api.py       # API client
│   └── risk_assessment.py     # Risk scoring & LLM
│
├── controllers/                # Business Orchestration
│   ├── bulk_search.py         # Bulk CPF searches
│   └── csv_processor.py       # CSV file processing
│
├── views/                      # UI Components
│   ├── auth_components.py     # Login & user info
│   ├── bulk_search_components.py  # Bulk results UI
│   ├── process_components.py  # Process details
│   └── risk_components.py     # Risk assessment panels
│
├── utils/                      # Utilities
│   ├── data_helpers.py        # Formatting & validation
│   └── file_storage.py        # JSON persistence
│
└── docs/                       # Documentation
    ├── RISK_ASSESSMENT_README.md      # Risk feature docs
    ├── SETUP_RISK_ASSESSMENT.md       # Quick setup
    ├── MVC_ARCHITECTURE.md            # Architecture guide
    └── REFACTORING_SUMMARY.md         # Code organization
```

## 📖 Usage

### Single Search

1. Enter a **name** or **CPF** in the search box
2. Click "🔍 New Search"
3. View results with:
   - Risk assessment panel
   - Process statistics
   - Detailed process information
4. Click "Get Details" on processes for movement history

### Bulk Search (CSV)

1. Switch to "📂 Bulk Search (CSV)" tab
2. Upload CSV file containing CPFs
3. Preview extracted CPFs
4. Click "🔍 Start Bulk Search"
5. Wait for completion (progress bar shows status)
6. View results with:
   - Summary statistics
   - Risk level breakdown
   - Individual risk assessments
7. Click "📥 Download Results (CSV)" to export

### Search History

- All searches automatically saved
- Access from sidebar
- Click "📂 Open" to reload a search
- Click "🗑️ Delete" to remove from history

## 🎯 Risk Assessment

The system evaluates employment risk using AI and quantitative metrics.

### Risk Factors (Weighted)

1. **Process Count (25%)**
   - 0 processes: 0 points
   - 1 process: 20 points
   - 2 processes: 35 points
   - 3-5 processes: 50 points
   - 6-10 processes: 70 points
   - 10+ processes: 70+ points

2. **Defendant Role (30%)**
   - Percentage of cases as defendant
   - Higher risk than plaintiff role
   - Keywords: réu, executado, demandado

3. **Case Severity (25%)**
   - Criminal/Penal: 100 (highest)
   - Labor (Trabalhista): 70
   - Execution: 60
   - Civil: 40
   - Family/Consumer: 25-30

4. **Financial Exposure (20%)**
   - < R$ 10k: 20 points
   - R$ 10k-50k: 35 points
   - R$ 50k-100k: 50 points
   - R$ 100k-500k: 70 points
   - R$ 500k+: 70+ points

### Risk Levels

| Level | Score | Color | Meaning |
|-------|-------|-------|---------|
| ✅ Low | 0-25 | Green | Minimal concerns - approve |
| ⚠️ Medium | 26-50 | Orange | Some concerns - review |
| 🔴 High | 51-75 | Red | Significant concerns - careful review |
| ⛔ Critical | 76-100 | Dark Red | Major red flags - high caution |

### AI Insights

Google Gemini analyzes each case and provides:
- **Key Insights**: 2-3 bullet points about findings
- **Red Flags**: Specific concerns identified
- **Recommendation**: Clear guidance (approve/review/reject)
- **Context**: Understands Brazilian legal system

### Privacy & Cost

**Privacy:**
- Data sent to Google's Gemini API
- Google doesn't use API data for training
- All data encrypted in transit (HTTPS)
- Consider data sensitivity for your use case

**Cost:**
- **Free Tier**: 1,500 requests/day (no credit card)
- **Paid Tier**: ~$0.00015 per analysis
- **100 checks**: < $0.02 (two cents)

## 🔧 Development

### MVC Architecture

The application follows Model-View-Controller pattern:

- **Models**: Business logic, data operations
- **Views**: UI components (Streamlit)
- **Controllers**: Orchestrate models and views
- **Utils**: Reusable helper functions
- **Config**: Centralized configuration

### Running Tests

```bash
# Unit tests (models & utils)
pytest tests/test_models.py
pytest tests/test_utils.py

# Integration tests (controllers)
pytest tests/test_controllers.py

# All tests
pytest
```

### Adding New Features

Example: Add email notifications

1. **Model** (`models/notifications.py`):
```python
class EmailNotifier:
    def send_risk_alert(self, cpf, risk_data):
        # Email logic
        pass
```

2. **Controller** (`controllers/bulk_search.py`):
```python
if risk_data['level'] == 'critical':
    notifier.send_risk_alert(cpf, risk_data)
```

3. **View** (`views/risk_components.py`):
```python
st.info("📧 Alert sent to HR team")
```

### Code Style

- Follow PEP 8 guidelines
- Use type hints
- Add docstrings to all functions
- Keep modules under 300 lines
- Single responsibility principle

## 📚 Documentation

Comprehensive documentation available:

- **[RISK_ASSESSMENT_README.md](RISK_ASSESSMENT_README.md)**: Complete risk assessment guide
- **[SETUP_RISK_ASSESSMENT.md](SETUP_RISK_ASSESSMENT.md)**: 5-minute setup guide
- **[MVC_ARCHITECTURE.md](MVC_ARCHITECTURE.md)**: Architecture documentation
- **[REFACTORING_SUMMARY.md](REFACTORING_SUMMARY.md)**: Code organization details

## 🤝 Contributing

### Guidelines

1. Follow MVC pattern
2. Keep modules focused (single responsibility)
3. Add tests for new features
4. Update documentation
5. Use clear commit messages

### Development Workflow

```bash
# Create feature branch
git checkout -b feature/new-feature

# Make changes
# ... edit files ...

# Run tests
pytest

# Commit changes
git add .
git commit -m "Add: new feature description"

# Push and create PR
git push origin feature/new-feature
```

## 🐛 Troubleshooting

### LLM Not Available

**Error**: "LLM analysis unavailable"

**Solutions:**
1. Check `GEMINI_API_KEY` in `.streamlit/secrets.toml`
2. Verify API key at https://aistudio.google.com/app/apikey
3. Check you haven't exceeded free tier (1500/day)
4. Test key in Google AI Studio

### Import Errors

**Error**: `ModuleNotFoundError`

**Solution:**
```bash
pip install -r requirements.txt
```

### Authentication Failed

**Error**: "Invalid username or password"

**Solution:**
1. Check `.streamlit/secrets.toml` has `[USUARIOS_APP]` section
2. Verify username and password match exactly
3. Passwords are case-sensitive

### Rate Limits

**Error**: 429 or "quota exceeded"

**Solution:**
- Free tier: 15 requests/minute, 1500/day
- Wait and retry
- Consider upgrading to paid tier
- For bulk searches, spread over time

## 📊 Performance

### Response Times
- Single search: 2-3 seconds
- Risk assessment: 1-2 seconds
- Bulk search (100 CPFs): 3-5 minutes

### Resource Usage
- Memory: ~200MB
- CPU: Low (API-based processing)
- Disk: Minimal (JSON history files)

## 🔒 Security

### Best Practices
1. Never commit `secrets.toml` to git
2. Use environment variables in production
3. Rotate API keys periodically
4. Use separate keys for dev/staging/prod
5. Monitor API usage regularly

### Data Privacy
- Judicial process data sent to Google API
- Review Google's privacy policy
- Consider data sensitivity
- Implement audit logging if needed

## 📄 License

This project is proprietary software. All rights reserved.

## 📞 Support

For issues or questions:
1. Check documentation in `/docs`
2. Review troubleshooting section
3. Check Google Cloud status
4. Open issue in repository

---

**Version**: 2.0 (MVC + Risk Assessment)
**Last Updated**: 2025-10-21
**Python**: 3.8+
**Framework**: Streamlit 1.48.1
**AI**: Google Gemini 1.5
