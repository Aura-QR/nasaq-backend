# 🎓 Nasaq School System - Backend

A comprehensive school management system backend built with NestJS and MongoDB. This API provides robust endpoints for managing students, teachers, classes, subjects, and administrative operations.

## 🚀 Features

- **Admin Management** - Secure admin authentication and authorization
- **Student Management** - Complete CRUD operations for student records
- **Teacher Management** - Manage teacher profiles and assignments
- **Class Management** - Organize and manage classes
- **Subject Management** - Create and manage subjects
- **API Documentation** - Interactive Swagger/OpenAPI documentation

## 🛠️ Tech Stack

- **Framework:** NestJS
- **Database:** MongoDB
- **Language:** TypeScript
- **API Documentation:** Swagger/OpenAPI
- **Validation:** class-validator & class-transformer

## 📋 Prerequisites

Before you begin, ensure you have the following installed:
- Node.js (v14 or higher)
- npm or yarn
- MongoDB instance (local or cloud)

## ⚙️ Installation & Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd Aura-School-System-Backend
   ```

2. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```
   
3. **Configure your database**
   
   Open the `.env` file and replace `MONGO_URI` with your MongoDB connection string:
   ```
   MONGO_URI=your_mongodb_connection_string
   ```

4. **Install dependencies**
   ```bash
   npm i --legacy-peer-deps
   ```

## 🏃 Running the Application

Start the development server:
```bash
npm run dev
```

The server will start on `http://localhost:3000`

## 📚 API Documentation

Once the application is running, you can access the interactive API documentation at:

**Swagger UI:** [http://localhost:3000/api/docs](http://localhost:3000/api/docs)

The Swagger interface provides:
- Complete API endpoint documentation
- Request/response schemas
- Interactive API testing
- Authentication flows

## 📁 Project Structure

```
src/
├── admin/          # Admin authentication & management
├── classes/        # Class management module
├── students/       # Student management module
├── teachers/       # Teacher management module
├── subjects/       # Subject management module
├── config/         # Configuration files
├── filters/        # Exception filters
├── interceptors/   # Response interceptors
└── main.ts         # Application entry point
```

## 🔒 Security

This application includes:
- Input validation using DTOs
- Request sanitization
- Error handling with custom filters
- Secure authentication mechanisms

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📝 License

[Add your license here]

---

**Note:** This is a backend API service. Make sure to configure CORS settings appropriately when connecting with a frontend application.