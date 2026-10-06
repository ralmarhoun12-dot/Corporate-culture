# Requested changes
- [x] Improve supplied logo presentation by avoiding enlargement; higher-resolution replacement blocked on original artwork.
- [x] Replace unsafe device-only accounts with shared authenticated persistence.
- [x] Connect every activity and private attachments, including quizzes and puzzle results; await Cloud confirmation before success.
- [ ] Verify owner isolation, session restoration, sign-out and manager reporting (blocked: no authenticated users exist; authenticated path UNVERIFIED). Anonymous writes and invalid sign-in rejected; public views tested without runtime errors; security linter clean.
- [ ] Assign the real manager role after a verified account is identified (blocked: supplied `admin` is a username, not an authenticated identity).