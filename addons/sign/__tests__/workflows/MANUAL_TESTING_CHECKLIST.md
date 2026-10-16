# 📋 MANUAL WORKFLOW TESTING CHECKLIST

**Critical for Dec 1st Launch**
**Duration**: 2-3 hours for complete testing
**Testers Needed**: 3-4 people

---

## 🎯 CRITICAL PATH 1: New User Sign Up & Login

### Test Case 1.1: User Registration

**Tester**: _____________
**Date**: _____________
**Environment**: Production / Staging (circle one)

**Steps**:
1. ☐ Navigate to https://app.synergysign.com
2. ☐ Click "Sign Up" button
3. ☐ Enter valid details:
   - Name: Test User [YourName]
   - Email: test.[yourname]@example.com
   - Password: TestPassword123!
4. ☐ Click "Create Account"
5. ☐ Verify success message appears
6. ☐ Check email inbox for verification email
7. ☐ Verify email received within 2 minutes
8. ☐ Click verification link in email
9. ☐ Verify "Email Verified" success message

**Expected Results**:
- ✅ Account created successfully
- ✅ Verification email received
- ✅ Email verified successfully
- ✅ No error messages

**Actual Results**: ___________________________________

**Status**: ☐ PASS  ☐ FAIL  ☐ BLOCKED

**Issues Found**: ___________________________________

---

### Test Case 1.2: User Login

**Steps**:
1. ☐ Navigate to https://app.synergysign.com/auth/signin
2. ☐ Enter email from Test 1.1
3. ☐ Enter password from Test 1.1
4. ☐ Click "Sign In"
5. ☐ Verify redirected to dashboard
6. ☐ Verify user name displayed in header
7. ☐ Verify dashboard loads within 3 seconds

**Expected Results**:
- ✅ Login successful
- ✅ Dashboard loads
- ✅ User details displayed
- ✅ No errors

**Status**: ☐ PASS  ☐ FAIL  ☐ BLOCKED

---

### Test Case 1.3: Invalid Login Attempts

**Steps**:
1. ☐ Try login with wrong password
   - Expected: Error message "Invalid credentials"
2. ☐ Try login with non-existent email
   - Expected: Error message "Account not found"
3. ☐ Try login with empty fields
   - Expected: Validation errors
4. ☐ Try 5 failed logins in a row
   - Expected: Rate limiting message (if implemented)

**Status**: ☐ PASS  ☐ FAIL  ☐ BLOCKED

---

## 🎯 CRITICAL PATH 2: Upload & Prepare Document

### Test Case 2.1: Document Upload

**Tester**: _____________
**Date**: _____________

**Preparation**:
- Download test PDF: [Create a simple PDF contract, ~1-2 pages]

**Steps**:
1. ☐ From dashboard, click "Upload Document" or "New Document"
2. ☐ Click file upload button
3. ☐ Select test PDF file (< 5MB)
4. ☐ Verify upload progress indicator shows
5. ☐ Verify upload completes within 10 seconds
6. ☐ Verify document appears in document list
7. ☐ Click on uploaded document
8. ☐ Verify PDF preview loads correctly
9. ☐ Verify all pages visible

**Expected Results**:
- ✅ File uploads successfully
- ✅ Progress indicator shown
- ✅ Document appears in list
- ✅ PDF renders correctly
- ✅ All pages visible

**Status**: ☐ PASS  ☐ FAIL  ☐ BLOCKED

---

### Test Case 2.2: Add Signature Field

**Steps**:
1. ☐ Open uploaded document
2. ☐ Click "Add Field" or similar button
3. ☐ Select "Signature" field type
4. ☐ Click on document to place field (try page 1, bottom)
5. ☐ Verify signature field appears on document
6. ☐ Try dragging field to different position
7. ☐ Try resizing field (if supported)
8. ☐ Mark field as "Required"
9. ☐ Save changes
10. ☐ Verify field persists after page refresh

**Expected Results**:
- ✅ Signature field added
- ✅ Field is draggable
- ✅ Field is resizable
- ✅ Required flag works
- ✅ Changes saved

**Status**: ☐ PASS  ☐ FAIL  ☐ BLOCKED

---

### Test Case 2.3: Add Multiple Field Types

**Steps**:
1. ☐ Add Date field
2. ☐ Add Text field
3. ☐ Add Initials field (if available)
4. ☐ Add Checkbox (if available)
5. ☐ Verify all fields visible
6. ☐ Save document

**Expected Results**:
- ✅ All field types added successfully
- ✅ Fields don't overlap
- ✅ Fields saved

**Status**: ☐ PASS  ☐ FAIL  ☐ BLOCKED

---

## 🎯 CRITICAL PATH 3: Send Document for Signature

### Test Case 3.1: Add Signer

**Tester**: _____________
**Preparation**: Have access to a second email address

**Steps**:
1. ☐ Open document with fields
2. ☐ Click "Send for Signature" or "Add Signer"
3. ☐ Enter signer details:
   - Email: [your second email]
   - Name: Test Signer
4. ☐ Assign fields to signer (drag signature field to signer)
5. ☐ Verify field assigned correctly
6. ☐ Add custom message (optional)
7. ☐ Click "Send" or "Request Signature"

**Expected Results**:
- ✅ Signer added successfully
- ✅ Fields assigned to signer
- ✅ No validation errors

**Status**: ☐ PASS  ☐ FAIL  ☐ BLOCKED

---

### Test Case 3.2: Verify Email Sent

**Steps**:
1. ☐ Check signer email inbox
2. ☐ Verify email received within 2 minutes
3. ☐ Verify email contains:
   - Document name
   - Sender name
   - Signing link
   - Clear call-to-action
4. ☐ Verify signing link is clickable
5. ☐ Verify link doesn't expose sensitive info (check URL)

**Expected Results**:
- ✅ Email received quickly
- ✅ Email well-formatted
- ✅ Link works
- ✅ No security issues in URL

**Status**: ☐ PASS  ☐ FAIL  ☐ BLOCKED

---

### Test Case 3.3: Document Status Updated

**Steps**:
1. ☐ Return to sender's dashboard
2. ☐ Find sent document
3. ☐ Verify status changed from "DRAFT" to "SENT" or "PENDING"
4. ☐ Verify signer status shows "Pending"
5. ☐ Verify timestamp of send action

**Expected Results**:
- ✅ Document status updated
- ✅ Signer shows pending
- ✅ Timestamp accurate

**Status**: ☐ PASS  ☐ FAIL  ☐ BLOCKED

---

## 🎯 CRITICAL PATH 4: Sign Document (Signer View)

### Test Case 4.1: Open Signing Link

**Tester**: _____________
**Switch to signer email**: _____________

**Steps**:
1. ☐ Open email from Test 3.2
2. ☐ Click signing link
3. ☐ Verify redirected to signing page
4. ☐ Verify page loads within 3 seconds
5. ☐ Verify document renders correctly
6. ☐ Verify signer name displayed
7. ☐ Verify no login required (if using access token)

**Expected Results**:
- ✅ Page loads quickly
- ✅ Document visible
- ✅ Signer identified
- ✅ No errors

**Status**: ☐ PASS  ☐ FAIL  ☐ BLOCKED

---

### Test Case 4.2: Fill Signature Field

**Steps**:
1. ☐ Click on signature field
2. ☐ Verify signature modal/panel opens
3. ☐ Try "Draw" signature option
   - Draw signature with mouse
   - Verify it appears in field
4. ☐ Try "Type" signature option (if available)
   - Type name
   - Select font
   - Verify it appears in field
5. ☐ Try "Upload" signature option (if available)
   - Upload image
   - Verify it appears in field
6. ☐ Click "Adopt and Sign" or "Apply"

**Expected Results**:
- ✅ Signature modal works
- ✅ Draw works
- ✅ Type works (if available)
- ✅ Upload works (if available)
- ✅ Signature applied to field

**Status**: ☐ PASS  ☐ FAIL  ☐ BLOCKED

---

### Test Case 4.3: Fill Other Fields

**Steps**:
1. ☐ Click on Date field
2. ☐ Verify date picker appears
3. ☐ Select today's date
4. ☐ Verify date applied
5. ☐ Fill Text field (if exists)
6. ☐ Check Checkbox (if exists)

**Expected Results**:
- ✅ All fields fillable
- ✅ Date picker works
- ✅ Text entry works
- ✅ Checkbox works

**Status**: ☐ PASS  ☐ FAIL  ☐ BLOCKED

---

### Test Case 4.4: Submit Signature

**Steps**:
1. ☐ Verify all required fields filled
2. ☐ Click "Submit" or "Finish Signing"
3. ☐ Verify confirmation message appears
4. ☐ Verify success page loads
5. ☐ Verify option to download signed document

**Expected Results**:
- ✅ Submission successful
- ✅ Confirmation shown
- ✅ Success page loads
- ✅ Download option available

**Status**: ☐ PASS  ☐ FAIL  ☐ BLOCKED

---

### Test Case 4.5: Verify Notifications Sent

**Steps**:
1. ☐ Check signer email for completion confirmation
2. ☐ Switch to sender email
3. ☐ Check for "document signed" notification email
4. ☐ Verify email received within 5 minutes
5. ☐ Verify email contains link to view signed document

**Expected Results**:
- ✅ Signer gets confirmation
- ✅ Sender gets notification
- ✅ Emails sent promptly
- ✅ Links work

**Status**: ☐ PASS  ☐ FAIL  ☐ BLOCKED

---

## 🎯 CRITICAL PATH 5: View & Download Signed Document

### Test Case 5.1: Document Status Updated

**Tester**: _____________
**Switch back to sender account**: _____________

**Steps**:
1. ☐ Log in as sender
2. ☐ Navigate to documents list
3. ☐ Find signed document
4. ☐ Verify status shows "COMPLETED"
5. ☐ Verify "Completed at" timestamp
6. ☐ Verify all signers show "Signed" status

**Expected Results**:
- ✅ Status updated to COMPLETED
- ✅ Timestamp accurate
- ✅ Signer status updated

**Status**: ☐ PASS  ☐ FAIL  ☐ BLOCKED

---

### Test Case 5.2: Download Signed Document

**Steps**:
1. ☐ Click "Download" or "Download Signed PDF"
2. ☐ Verify download starts
3. ☐ Verify file downloads within 10 seconds
4. ☐ Open downloaded PDF
5. ☐ Verify signatures appear in document
6. ☐ Verify all fields filled correctly
7. ☐ Verify no quality loss

**Expected Results**:
- ✅ Download works
- ✅ PDF opens correctly
- ✅ Signatures visible
- ✅ Fields filled
- ✅ Good quality

**Status**: ☐ PASS  ☐ FAIL  ☐ BLOCKED

---

### Test Case 5.3: Audit Trail

**Steps**:
1. ☐ Click "View Audit Trail" or "History"
2. ☐ Verify shows timeline of events:
   - Document created
   - Sent to signer
   - Signer opened document
   - Signer signed document
   - Document completed
3. ☐ Verify timestamps for all events
4. ☐ Verify IP addresses recorded (if shown)

**Expected Results**:
- ✅ Audit trail accessible
- ✅ All events logged
- ✅ Timestamps accurate
- ✅ IP addresses logged

**Status**: ☐ PASS  ☐ FAIL  ☐ BLOCKED

---

## 🎯 CRITICAL PATH 6: Billing & Subscription

### Test Case 6.1: View Subscription Status

**Tester**: _____________

**Steps**:
1. ☐ Navigate to "Billing" or "Subscription"
2. ☐ Verify current tier displayed (FREE/BASIC/PRO)
3. ☐ Verify usage statistics shown:
   - Documents this month
   - Limit for tier
   - Progress bar or indicator
4. ☐ Verify upgrade button visible (if on FREE)

**Expected Results**:
- ✅ Tier displayed correctly
- ✅ Usage accurate
- ✅ Limits clear
- ✅ Upgrade option visible

**Status**: ☐ PASS  ☐ FAIL  ☐ BLOCKED

---

### Test Case 6.2: Upgrade Flow (TEST MODE ONLY)

**⚠️ IMPORTANT**: Use Stripe test mode with test cards

**Steps**:
1. ☐ Click "Upgrade" button
2. ☐ Select PRO tier (or desired tier)
3. ☐ Click "Subscribe" or "Checkout"
4. ☐ Verify redirected to Stripe checkout
5. ☐ Enter test card: 4242 4242 4242 4242
6. ☐ Expiry: Any future date (e.g., 12/34)
7. ☐ CVC: Any 3 digits (e.g., 123)
8. ☐ ZIP: Any 5 digits (e.g., 12345)
9. ☐ Click "Pay" or "Subscribe"
10. ☐ Verify redirected back to app
11. ☐ Verify success message
12. ☐ Verify tier updated to PRO

**Expected Results**:
- ✅ Stripe checkout loads
- ✅ Test payment processes
- ✅ Redirected back to app
- ✅ Tier upgraded
- ✅ No errors

**Status**: ☐ PASS  ☐ FAIL  ☐ BLOCKED

**⚠️ Important**: Cancel test subscription immediately after test!

---

## 🎯 CRITICAL PATH 7: Multi-Party Signing

### Test Case 7.1: Add Multiple Signers

**Tester**: _____________
**Preparation**: Need 2 additional email addresses

**Steps**:
1. ☐ Upload new document
2. ☐ Add fields for 2 signers
3. ☐ Add Signer 1:
   - Email: [email 1]
   - Name: Signer One
   - Order: 1
4. ☐ Add Signer 2:
   - Email: [email 2]
   - Name: Signer Two
   - Order: 2
5. ☐ Assign fields to each signer
6. ☐ Send document
7. ☐ Verify both signers receive emails

**Expected Results**:
- ✅ Multiple signers added
- ✅ Order set correctly
- ✅ Fields assigned
- ✅ Both emails sent

**Status**: ☐ PASS  ☐ FAIL  ☐ BLOCKED

---

### Test Case 7.2: Sequential Signing

**Steps**:
1. ☐ Signer 1 opens link and signs
2. ☐ Verify Signer 2 receives notification
3. ☐ Verify Signer 2 can now sign
4. ☐ Signer 2 opens link and signs
5. ☐ Verify document marked complete
6. ☐ Verify sender notified

**Expected Results**:
- ✅ Sequential order enforced
- ✅ Notifications sent
- ✅ Both can sign
- ✅ Document completes

**Status**: ☐ PASS  ☐ FAIL  ☐ BLOCKED

---

## 🎯 CRITICAL PATH 8: Error Scenarios

### Test Case 8.1: Network Errors

**Steps**:
1. ☐ Start uploading large file
2. ☐ Disable network mid-upload
3. ☐ Verify error message shown
4. ☐ Re-enable network
5. ☐ Verify retry option available
6. ☐ Retry upload
7. ☐ Verify completes successfully

**Expected Results**:
- ✅ Error handled gracefully
- ✅ Clear error message
- ✅ Retry option works
- ✅ No data loss

**Status**: ☐ PASS  ☐ FAIL  ☐ BLOCKED

---

### Test Case 8.2: Invalid File Types

**Steps**:
1. ☐ Try uploading .docx file
   - Expected: Error message
2. ☐ Try uploading .exe file
   - Expected: Error message
3. ☐ Try uploading .html file
   - Expected: Error message
4. ☐ Verify only .pdf accepted

**Expected Results**:
- ✅ Non-PDF rejected
- ✅ Clear error messages
- ✅ No security issues

**Status**: ☐ PASS  ☐ FAIL  ☐ BLOCKED

---

### Test Case 8.3: Expired Links

**Steps**:
1. ☐ Get a signing link
2. ☐ Wait for link to expire (or manually expire in DB)
3. ☐ Try accessing expired link
4. ☐ Verify error message shown
5. ☐ Verify option to request new link

**Expected Results**:
- ✅ Expired link detected
- ✅ Clear error message
- ✅ Request new link option

**Status**: ☐ PASS  ☐ FAIL  ☐ BLOCKED

---

## 🎯 PERFORMANCE TESTS

### Test Case 9.1: Page Load Times

**Tester**: _____________
**Tool**: Use browser DevTools (F12 → Network tab)

**Steps**:
1. ☐ Clear cache and cookies
2. ☐ Load homepage
   - Record load time: _______ seconds
   - Target: < 3 seconds
3. ☐ Load dashboard
   - Record load time: _______ seconds
   - Target: < 3 seconds
4. ☐ Load document viewer
   - Record load time: _______ seconds
   - Target: < 5 seconds

**Expected Results**:
- ✅ All pages load within targets
- ✅ No console errors
- ✅ No 404s or failed requests

**Status**: ☐ PASS  ☐ FAIL  ☐ BLOCKED

---

### Test Case 9.2: Large Document Handling

**Preparation**: Create or download a 10MB PDF (large document)

**Steps**:
1. ☐ Upload 10MB PDF
2. ☐ Record upload time: _______ seconds
3. ☐ Verify upload completes (target: < 30 seconds)
4. ☐ Open document in viewer
5. ☐ Record render time: _______ seconds
6. ☐ Verify renders (target: < 10 seconds)
7. ☐ Try scrolling through pages
8. ☐ Verify smooth performance

**Expected Results**:
- ✅ Large file uploads
- ✅ Within time targets
- ✅ Renders correctly
- ✅ Smooth scrolling

**Status**: ☐ PASS  ☐ FAIL  ☐ BLOCKED

---

## 🎯 MOBILE TESTING (if time allows)

### Test Case 10.1: Mobile Sign Experience

**Tester**: _____________
**Device**: _____________
**Browser**: _____________

**Steps**:
1. ☐ Open signing link on mobile device
2. ☐ Verify page responsive
3. ☐ Verify document readable
4. ☐ Try drawing signature with finger
5. ☐ Verify signature smooth
6. ☐ Complete signing process
7. ☐ Verify successful

**Expected Results**:
- ✅ Mobile-responsive
- ✅ Document readable
- ✅ Touch drawing works
- ✅ Process completes

**Status**: ☐ PASS  ☐ FAIL  ☐ BLOCKED

---

## 📊 TESTING SUMMARY

**Testing Completed By**: _____________
**Date**: _____________
**Total Test Cases**: 25+
**Passed**: _____
**Failed**: _____
**Blocked**: _____
**Pass Rate**: _____%

### Critical Issues Found (P0 - Must fix before launch):
1. _______________________________________________
2. _______________________________________________
3. _______________________________________________

### Important Issues (P1 - Should fix before launch):
1. _______________________________________________
2. _______________________________________________
3. _______________________________________________

### Minor Issues (P2 - Can fix after launch):
1. _______________________________________________
2. _______________________________________________
3. _______________________________________________

### GO/NO-GO DECISION:

☐ **GO FOR LAUNCH** - All critical tests passed, no P0 issues

☐ **NO-GO** - Critical issues found, need to be fixed first

**Sign-off**:
- Tester: _________________ Date: _______
- Tech Lead: _________________ Date: _______
- Product Manager: _________________ Date: _______

---

## 🎯 PRE-LAUNCH FINAL CHECK (December 1st Morning)

**Time**: 10:00 AM
**Duration**: 30 minutes
**Team**: All hands

**Quick Smoke Test** (Run all these in 30 minutes):

1. ☐ Site loads: https://app.synergysign.com
2. ☐ SSL certificate valid (green padlock in browser)
3. ☐ Signup works
4. ☐ Login works
5. ☐ Upload document works
6. ☐ Send for signature works
7. ☐ Signing link works
8. ☐ Signature works
9. ☐ Download works
10. ☐ No errors in browser console

**If ALL 10 pass**: ✅ **GO FOR LAUNCH at 12:30 PM**

**If ANY fail**: ⚠️ **DELAY - Fix immediately**

---

**End of Manual Testing Checklist**
