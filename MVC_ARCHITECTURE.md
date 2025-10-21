# MVC Architecture Documentation

## Overview

The application has been refactored from a single monolithic file (~1700 lines) into a clean Model-View-Controller (MVC) architecture with smaller, maintainable modules.

## Project Structure

```
mvp-sturdy-waddle/
├── app.py                          # Main application entry point (350 lines)
├── app_old_backup.py              # Original monolithic code (backup)
│
├── config/                         # Configuration
│   ├── __init__.py
│   └── settings.py                # Centralized configuration
│
├── models/                         # Business Logic & Data Models
│   ├── __init__.py
│   ├── analytics.py               # Posthog analytics integration
│   ├── auth.py                    # Authentication & session management
│   ├── predictus_api.py           # External API communication
│   └── risk_assessment.py         # Risk scoring & LLM integration
│
├── controllers/                    # Business Logic Controllers
│   ├── __init__.py
│   ├── bulk_search.py             # Bulk CPF search orchestration
│   └── csv_processor.py           # CSV file processing
│
├── views/                          # UI Components (Streamlit)
│   ├── __init__.py
│   ├── auth_components.py         # Login & user info display
│   ├── bulk_search_components.py  # Bulk search results UI
│   ├── process_components.py      # Process details display
│   └── risk_components.py         # Risk assessment panels
│
└── utils/                          # Utility Functions
    ├── __init__.py
    ├── data_helpers.py            # Data formatting & validation
    └── file_storage.py            # JSON file operations
```

## Module Responsibilities

### 1. Config Layer (`config/`)

**settings.py**
- Application-wide constants
- Path configuration
- API endpoints
- File upload limits

### 2. Model Layer (`models/`)

Models handle business logic and data operations:

**analytics.py** - `PosthogAPI`
- Analytics event tracking
- User identification
- Event properties management

**auth.py** - `AuthenticationManager`
- User authentication
- Password hashing
- Session management
- Logout handling

**predictus_api.py** - `PredictusAPI`
- External API communication
- Authentication token management
- Search operations (by name, CPF, process number)
- Error handling & retry logic

**risk_assessment.py** - `RiskAssessmentLLM` & `RiskAssessor`
- Google Gemini LLM integration
- Risk score calculation (4-factor algorithm)
- LLM prompt engineering
- Response parsing
- Risk level classification

### 3. Controller Layer (`controllers/`)

Controllers orchestrate business logic:

**csv_processor.py** - `CSVProcessor`
- CSV file validation
- CPF extraction from text
- Data frame processing
- Error handling

**bulk_search.py** - `BulkSearchManager`
- Bulk search orchestration
- Progress tracking
- Risk assessment integration
- Results aggregation
- CSV export generation

### 4. View Layer (`views/`)

Views handle UI rendering (Streamlit components):

**auth_components.py** - `AuthViewComponents`
- Login screen
- User info sidebar
- Session display

**process_components.py** - `ProcessViewComponents`
- Process details panels
- Movement history display
- Party information
- Lawyer details
- Court information

**risk_components.py** - `RiskViewComponents`
- Risk assessment panels
- Factor breakdowns
- Progress bars
- LLM insights display
- Red flags warnings
- Risk badges

**bulk_search_components.py** - `BulkSearchViewComponents`
- Bulk search results display
- Summary statistics
- Risk level aggregation
- CSV download buttons
- Error display

### 5. Utils Layer (`utils/`)

Utility functions for common operations:

**data_helpers.py**
- `DataFormatter`: Text cleaning, CPF formatting, currency formatting, date formatting
- `CPFValidator`: CPF validation, extraction from text

**file_storage.py** - `FileStorage`
- Search history persistence
- Process details storage
- JSON file operations

### 6. Main Application (`app.py`)

Orchestrates the entire application:
- Session state initialization
- Routing between login/main app
- Search interface rendering
- Result display coordination
- History management

## Benefits of MVC Refactoring

### 1. Maintainability
- **Before**: 1700 lines in one file
- **After**: ~15 files, avg 150 lines each
- Easy to locate and fix bugs
- Clear responsibility boundaries

### 2. Testability
- Each module can be tested independently
- Mock external dependencies easily
- Unit tests for models, integration tests for controllers
- View components can be tested in isolation

### 3. Reusability
- Models can be reused in CLI tools or APIs
- Utils can be shared across projects
- Views can be refactored without touching logic

### 4. Collaboration
- Multiple developers can work on different modules
- Clear interfaces reduce merge conflicts
- New team members understand structure faster

### 5. Scalability
- Easy to add new features (new controller + view)
- Models can be extended without affecting UI
- Configuration changes isolated to one file

## Common Development Tasks

### Adding a New Feature

**Example: Add email notifications for high-risk employees**

1. **Model** (`models/notifications.py`):
```python
class EmailNotifier:
    def send_risk_alert(self, cpf: str, risk_data: Dict):
        # Email logic here
        pass
```

2. **Controller** (`controllers/bulk_search.py`):
```python
# In BulkSearchManager.search_cpf_list()
if risk_data['level'] == 'critical':
    notifier.send_risk_alert(cpf, risk_data)
```

3. **View** (`views/risk_components.py`):
```python
# Add notification status to UI
st.info("📧 Alert sent to HR team")
```

4. **Config** (`config/settings.py`):
```python
EMAIL_SETTINGS = {
    "smtp_host": "smtp.gmail.com",
    "from_email": "noreply@company.com"
}
```

### Modifying Existing Features

**Example: Change risk scoring weights**

1. Only edit: `models/risk_assessment.py` - `RiskAssessor.WEIGHTS`
2. No changes needed to UI, controllers, or utils
3. Run tests to verify calculations

### Adding a New UI Component

**Example: Add a dashboard summary**

1. Create: `views/dashboard_components.py`
2. Import in `app.py`: `from views.dashboard_components import DashboardView`
3. Call in main: `DashboardView.render_summary()`
4. No changes to models or controllers needed

## Testing Strategy

### Unit Tests (models & utils)
```python
# tests/test_risk_assessment.py
def test_risk_calculation():
    assessor = RiskAssessor()
    risk = assessor.assess_risk(sample_processes, {"search_term": "123"})
    assert risk['level'] == 'medium'
    assert 25 < risk['score'] < 50
```

### Integration Tests (controllers)
```python
# tests/test_bulk_search.py
def test_bulk_search_with_mock_api():
    api = Mock(PredictusAPI)
    manager = BulkSearchManager(api, posthog)
    results = manager.search_cpf_list(['12345678901'])
    assert len(results['nada_consta']) == 1
```

### View Tests (Streamlit components)
```python
# tests/test_views.py
def test_risk_badge_rendering():
    risk_data = {"emoji": "✅", "score": 15, "level_label": "Low Risk"}
    badge = RiskViewComponents.render_risk_badge(risk_data)
    assert "Low Risk" in badge
    assert "15" in badge
```

## Performance Considerations

### Lazy Loading
- Models instantiated only when needed
- LLM client created on first use
- File storage accessed on demand

### Caching
- Gemini API results cached in session
- Risk assessments stored to avoid recalculation
- Search history loaded once per session

### Async Operations
- Bulk searches with progress callbacks
- Background API requests where possible
- Streamlit's native caching for expensive operations

## Security Best Practices

### Separation of Concerns
- Credentials only in `models/` layer
- No API keys in views or controllers
- Configuration in secrets.toml (not committed)

### Input Validation
- All user inputs validated in utils
- CPF format checking before API calls
- File upload size limits enforced

### Error Handling
- Try-catch blocks in all API calls
- Graceful degradation when LLM unavailable
- User-friendly error messages in views

## Migration from Old Code

The original `app.py` has been backed up as `app_old_backup.py`.

**Mapping old functions to new locations:**

| Old (app.py) | New Location |
|-------------|-------------|
| `DataManager.clean_text()` | `utils.data_helpers.DataFormatter.clean_text()` |
| `AuthenticationManager.*` | `models.auth.AuthenticationManager.*` |
| `PredictusAPI.*` | `models.predictus_api.PredictusAPI.*` |
| `RiskAssessor.*` | `models.risk_assessment.RiskAssessor.*` |
| `UIComponents.render_risk_*` | `views.risk_components.RiskViewComponents.*` |
| `CSVProcessor.*` | `controllers.csv_processor.CSVProcessor.*` |
| `BulkSearchManager.*` | `controllers.bulk_search.BulkSearchManager.*` |

## Future Enhancements

### Recommended Next Steps

1. **Add Unit Tests**
   - Create `tests/` directory
   - Write tests for each model
   - Aim for 80%+ code coverage

2. **Add API Layer**
   - Create REST API using FastAPI
   - Reuse existing models
   - Enable programmatic access

3. **Database Integration**
   - Replace JSON file storage
   - Add PostgreSQL/MongoDB
   - Implement `models/database.py`

4. **Async Processing**
   - Move bulk searches to background tasks
   - Add Celery for job queuing
   - Real-time progress updates via WebSockets

5. **Monitoring & Logging**
   - Add structured logging (`utils/logger.py`)
   - Integrate with Sentry for error tracking
   - Performance monitoring dashboard

## Contributing

When contributing to this codebase:

1. **Follow the MVC pattern**
   - Business logic → models/
   - UI components → views/
   - Orchestration → controllers/

2. **Keep modules focused**
   - Single responsibility principle
   - Max ~300 lines per file
   - Extract reusable code to utils/

3. **Document your changes**
   - Add docstrings to all functions
   - Update this README if adding new modules
   - Include type hints

4. **Write tests**
   - Unit tests for models
   - Integration tests for controllers
   - Consider view tests for complex UI logic

---

**Version**: 2.0 (MVC Refactored)
**Date**: 2025-10-21
**Lines of Code**: ~2000 (vs 1700 in monolith, but much more maintainable)
