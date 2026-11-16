# SkillProof – Verified Student Skill Passport

A MERN-stack FSD project starter with student, admin and recruiter roles.

## Requirements
- Node.js 18+
- A Supabase project

## 1. Supabase setup
Run `backend/schema.sql` in the Supabase SQL editor for a new project. For an existing project, run `backend/migrate_admin_review.sql` to ensure recruiters can only read verified submissions and project evidence.

To grant admin access, update the intended user's `profiles.role` to `admin` in Supabase. Admin accounts do not have a public registration option; they sign in using **Admin login**.

## 2. Backend setup
```bash
cd backend
npm install
```
Create `backend/.env` using `.env.example`, then:
```bash
npm run dev
```
Backend runs at http://localhost:5000

## 3. Frontend setup
Open another terminal:
```bash
cd frontend
npm install
npm run dev
```
Open the Vite URL shown in the terminal (usually http://localhost:5173).

## Demo accounts
Register normally to create a Student account. Recruiters can register using the recruiter flow. To create an admin for local testing, register normally and change the user's `role` field in the Supabase `profiles` table to `admin`.

## Included
- Registration and login with JWT
- Student profile
- Add skills, projects and certificates
- Student submissions start as Pending
- Admin dashboard can approve/reject student submissions with review notes
- Recruiters only see submissions and project evidence after admin verification
- Recruiter can search student profiles
- Public profile view

This is a college-project starter, not a production-ready credential verification service. Admin review is a manual review workflow; it does not independently prove that a certificate is genuine.
