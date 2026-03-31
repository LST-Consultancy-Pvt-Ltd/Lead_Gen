# 🚀 Quick Start Guide - CRM Leads API

## What's Been Implemented

A complete, production-ready CRM Leads backend with:

✅ **Role-Based Access Control (RBAC)**
- sales_user: View/edit only assigned leads
- manager: View/edit all org leads, can reassign
- org_admin/super_admin: Full access including delete

✅ **Automatic Activity Logging**
- All lead changes tracked
- Custom activities (calls, meetings, emails, etc.)
- Complete audit trail

✅ **Advanced Features**
- Duplicate detection (company + email)
- Search across multiple fields
- Filter by status, intent, assigned user
- Pagination with total count
- Comprehensive validation

✅ **Security**
- JWT authentication
- Rate limiting
- Input validation & sanitization
- Organization data isolation

---

## 📁 New Files Created

### Core Implementation
```
src/
├── controllers/
│   └── leads.controller.js      ✨ NEW - Main request handlers
├── services/
│   ├── leads.service.js         ✨ NEW - Business logic
│   └── activity.service.js      ✨ NEW - Activity tracking
├── routes/
│   └── leads.routes.js          ✨ NEW - API routes with validation
└── middleware/
    └── rbac.js                  ✨ NEW - Role-based permissions
```

### Documentation
```
LEADS_API_DOCUMENTATION.md       ✨ NEW - Complete API docs
CRM_IMPLEMENTATION_README.md     ✨ NEW - Implementation guide
postman_collection.json          ✨ NEW - Postman test collection
QUICK_START.md                   ✨ NEW - This file
```

### Updated Files
```
src/server.js                    ✏️  UPDATED - To use new routes
```

---

## ⚡ Quick Start (3 Steps)

### 1. Install & Setup (if not done)

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your database credentials

# Run migrations
npx prisma migrate dev
```

### 2. Start Server

```bash
# Development mode
npm run dev

# Production mode
npm start
```

Server will start on `http://localhost:5000`

### 3. Test API

Import `postman_collection.json` into Postman or use cURL:

```bash
# 1. Login to get token
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your@email.com",
    "password": "your_password"
  }'

# 2. Create a lead
curl -X POST http://localhost:5000/api/leads \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Tech Corp",
    "contactEmail": "john@techcorp.com",
    "status": "new"
  }'

# 3. Get all leads (filtered by your role)
curl -X GET "http://localhost:5000/api/leads?page=1&limit=20" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## 🎯 Key API Endpoints

| Endpoint | Method | Access | Purpose |
|----------|--------|--------|---------|
| `/api/leads` | GET | All | Get leads (role-filtered) |
| `/api/leads/stats` | GET | All | Get statistics |
| `/api/leads/:id` | GET | All | Get lead details |
| `/api/leads` | POST | All | Create lead |
| `/api/leads/:id` | PUT | All | Update lead |
| `/api/leads/:id` | DELETE | Admin | Delete lead |
| `/api/leads/:id/activities` | GET | All | Get activities |
| `/api/leads/:id/activities` | POST | All | Create activity |

---

## 🔑 Authentication

All endpoints require JWT token in header:

```
Authorization: Bearer YOUR_JWT_TOKEN
```

The token contains:
- User ID
- Role (sales_user, manager, org_admin, super_admin)
- Organization ID

---

## 👥 Role Permissions

### sales_user
```javascript
✅ Create leads (assigned to self)
✅ View assigned leads only
✅ Update assigned leads
✅ Add activities to assigned leads
❌ Reassign leads
❌ Delete leads
❌ View other users' leads
```

### manager
```javascript
✅ View all organization leads
✅ Update any lead
✅ Reassign leads
✅ Add activities to any lead
❌ Delete leads
```

### org_admin / super_admin
```javascript
✅ Full access to all features
✅ Delete leads
✅ Manage users
✅ Configure system
```

---

## 🔍 Search & Filter Examples

### Basic Search
```bash
GET /api/leads?search=tech&page=1&limit=20
```
Searches across: company name, contact name, email, industry, website

### Filter by Status
```bash
GET /api/leads?status=new
GET /api/leads?status=qualified
```
Valid statuses: `new`, `contacted`, `replied`, `meeting_booked`, `qualified`, `disqualified`, `closed_won`, `closed_lost`

### Filter by Intent
```bash
GET /api/leads?intent=hot
```
Valid intents: `hot`, `warm`, `cold`

### Combined Filters
```bash
GET /api/leads?status=qualified&intent=hot&search=tech&sortBy=leadScore&sortDir=desc
```

### Assign Filter (Manager/Admin only)
```bash
GET /api/leads?assignedTo=USER_ID
```

---

## 📝 Create Lead Examples

### Minimal (Only company name required)
```json
{
  "companyName": "Tech Corp"
}
```

### Complete
```json
{
  "companyName": "Tech Innovations Inc",
  "website": "https://techinnovations.com",
  "industry": "Technology",
  "companySize": "50-100",
  "location": "San Francisco, CA",
  "contactName": "John Smith",
  "contactEmail": "john@techcorp.com",
  "contactPhone": "+1-415-555-0123",
  "techStack": ["React", "Node.js", "AWS"],
  "status": "new",
  "intentLevel": "warm",
  "notes": "Interested in NetSuite"
}
```

---

## 📊 Activity Types

| Type | Description | Updates lastContactedAt |
|------|-------------|------------------------|
| `call` | Phone call | ✅ Yes |
| `email` | Email sent/received | ✅ Yes |
| `meeting` | Meeting scheduled/held | ✅ Yes |
| `demo` | Product demo | ✅ Yes |
| `whatsapp` | WhatsApp message | ✅ Yes |
| `linkedin` | LinkedIn interaction | ❌ No |
| `note` | Internal note | ❌ No |

### Create Activity Example
```json
{
  "action": "call",
  "description": "Discovery call completed. Discussed needs.",
  "metadata": {
    "duration": "30 minutes",
    "outcome": "positive",
    "nextStep": "Send proposal"
  }
}
```

---

## 🛡️ Security Features

1. **JWT Authentication**: All endpoints protected
2. **Rate Limiting**: Prevents abuse
3. **Input Validation**: All inputs sanitized
4. **Organization Isolation**: Users can't access other orgs
5. **Role-Based Access**: Automatic filtering by role
6. **Activity Logging**: Complete audit trail

---

## 🚨 Common Issues & Solutions

### Issue: "Unauthorized" error
**Solution**: Make sure you're sending the Bearer token in Authorization header

### Issue: "Insufficient permissions"
**Solution**: Check your user role. Some actions require manager/admin role

### Issue: "Lead not found"
**Solution**: 
- Verify the lead ID is correct
- Check if you have access to that lead (sales_user can only see assigned leads)

### Issue: "Duplicate lead" error
**Solution**: A lead with same company + email already exists. Use the returned `duplicateId` to update instead

### Issue: "Validation failed"
**Solution**: Check the error response for specific validation errors and fix the input

---

## 📚 Documentation Files

1. **LEADS_API_DOCUMENTATION.md** - Complete API reference with all endpoints, examples, and error codes

2. **CRM_IMPLEMENTATION_README.md** - Implementation details, architecture, and technical guide

3. **postman_collection.json** - Import into Postman for quick testing

4. **QUICK_START.md** - This file - Quick reference guide

---

## 🧪 Testing Workflow

### 1. Login & Get Token
```bash
POST /api/auth/login
```

### 2. Create Test Lead
```bash
POST /api/leads
Body: { "companyName": "Test Company", "contactEmail": "test@company.com" }
```

### 3. Update Lead Status
```bash
PUT /api/leads/:id
Body: { "status": "contacted" }
```

### 4. Add Activity
```bash
POST /api/leads/:id/activities
Body: { "action": "call", "description": "Made contact" }
```

### 5. View Activities
```bash
GET /api/leads/:id/activities
```

### 6. Get Statistics
```bash
GET /api/leads/stats
```

---

## 💡 Pro Tips

1. **Use Search Instead of Pagination**: When looking for specific leads, use the search param instead of paginating through all results

2. **Filter Hot Leads**: Use `?intent=hot&status=qualified` to focus on high-priority leads

3. **Log All Activities**: Track every interaction for complete visibility and better follow-ups

4. **Update Status Regularly**: Keep lead statuses current to maintain accurate pipeline visibility

5. **Use Metadata in Activities**: Store additional context in activity metadata for better tracking

6. **Check Stats Regularly**: Use `/api/leads/stats` to monitor your pipeline health

---

## 🔄 Typical Sales Workflow

```
1. Create Lead
   POST /api/leads

2. Initial Contact
   POST /api/leads/:id/activities (action: "call")
   PUT /api/leads/:id (status: "contacted")

3. Follow-up
   POST /api/leads/:id/activities (action: "email")
   PUT /api/leads/:id (status: "replied")

4. Meeting
   POST /api/leads/:id/activities (action: "meeting")
   PUT /api/leads/:id (status: "meeting_booked")

5. Demo
   POST /api/leads/:id/activities (action: "demo")
   PUT /api/leads/:id (status: "qualified", intentLevel: "hot")

6. Close
   PUT /api/leads/:id (status: "closed_won" or "closed_lost")
```

---

## 📈 Next Steps

1. **Test the API**: Import Postman collection and test all endpoints
2. **Integrate with Frontend**: Use the API in your React/Vue/Angular app
3. **Customize**: Add custom fields or business logic as needed
4. **Monitor**: Check logs for any errors or issues
5. **Scale**: Add caching, optimize queries as data grows

---

## 🆘 Support

- **API Documentation**: See `LEADS_API_DOCUMENTATION.md`
- **Implementation Guide**: See `CRM_IMPLEMENTATION_README.md`
- **Database Schema**: Check `prisma/schema.prisma`
- **Logs**: Check Winston logs for debugging

---

## ✅ Implementation Checklist

- [x] Role-based access control (RBAC)
- [x] Lead CRUD operations
- [x] Activity tracking
- [x] Automatic logging
- [x] Duplicate detection
- [x] Search & filtering
- [x] Pagination
- [x] Input validation
- [x] Error handling
- [x] Security (JWT, rate limiting)
- [x] Documentation
- [x] Postman collection

---

**Ready to go! 🎉**

Your CRM Leads API is production-ready and fully functional. Test it using the Postman collection or cURL commands above.
