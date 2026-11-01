# Dr. Dylan Thor P. Rullan — Website

Static website for Dr. Dylan Thor P. Rullan, Integrative & Naturopathic Medicine.

- `index.html` — the whole site (HTML, CSS and JS in one file)
- `images/` — hero cutout and About photo

## Edit practice details
Open `index.html` and edit the `PRACTICE` object near the top of the `<script>`: address, phone, email, fees, and consultation hours.

## Booking
The booking calendar works in the browser. On this static deployment it prepares a booking request (copy details / add to Google Calendar) rather than reserving a slot in a database. Connect a booking backend (e.g. GoHighLevel, Calendly, Cal.com or a form service) to take live reservations.

## Deploy
Hosted on Vercel as a static site. Every push to `main` redeploys automatically.

## Vercel settings (Environment Variables)
| Name | What it does |
|---|---|
| `BLOB_READ_WRITE_TOKEN` | Added automatically when you connect a **Private** Blob store (Storage → Blob). Stores bookings, payment screenshots and orders. |
| `ADMIN_KEY` | Password for the clinic admin page at `/admin`. |
| `GHL_BOOKING_WEBHOOK_URL` | GoHighLevel Inbound Webhook URL for bookings. Receives `booking.created`, `booking.confirmed`, `booking.payment_issue`, `booking.cancelled`. |
| `GHL_ORDER_WEBHOOK_URL` | GoHighLevel Inbound Webhook URL for shop orders. Receives `order.created`. |
| `GHL_API_TOKEN` | GoHighLevel **Private Integration** token (sub-account → Settings → Private Integrations). Scopes: contacts.write, contacts.readonly, calendars.readonly, calendars/events.write, calendars/events.readonly, medias.write. |
| `GHL_LOCATION_ID` | Sub-account (location) ID — Settings → Business Profile. |
| `GHL_CALENDAR_ID` | ID of the calendar bookings go on (Calendars → ⋯ → copy ID). |
| `GHL_CALENDAR_ID_ONLINE` | Optional. A separate calendar for online consults. |
| `GHL_ASSIGNED_USER_ID` | Optional. GHL user (Dr. Rullan) to assign appointments to. |
| `GHL_MEDIA_FOLDER_ID` | Optional. Media Library folder for payment screenshots. |
| `GHL_PAYMENT_FIELD_KEY` | Optional. Contact custom field key (e.g. `contact.payment_screenshot`) to store the screenshot link. |
| `GHL_CLINIC_ADDRESS` | Optional. Address shown on face-to-face appointments. |

### What the GoHighLevel API connection does
With `GHL_API_TOKEN`, `GHL_LOCATION_ID` and `GHL_CALENDAR_ID` set:
- **Booking:** creates/updates the contact (tags: website booking, consultation type, format, payment under review), uploads the payment screenshot to Media Storage, adds the appointment to the calendar (status *new*), and adds a note with the details and screenshot link.
- **Admin actions:** Mark paid → appointment *confirmed* + tag "payment verified"; Payment issue → tag "payment issue"; Cancel → appointment *cancelled*. Bookings made before the connection (or whose sync failed) are pushed to GHL on their next admin action.
- **Availability:** appointments and blocked time on the GHL calendar are hidden from the website calendar, so Dr. Rullan can block time in GHL.
- **Shop orders:** creates/updates the contact (tags: shop order, triangle of health) with the order as a note.
A GoHighLevel outage never blocks a booking or order; the website copy in Vercel Blob is kept either way.

Redeploy after adding or changing a variable.

### Booking webhook fields
`event, ref, status, status_label, first_name, last_name, full_name, email, phone (+63…), date_of_birth, appointment_type, appointment_type_label, duration_min, format, video_platform, date, time, date_label, time_label, start_iso, timezone, concern, notes, fee, currency, payment_method, payment_ref, has_payment_screenshot, ghl_contact_id, ghl_appointment_id, payment_screenshot_url, admin_url, source, created_at, updated_at`

### Order webhook fields
`event, ref, status, first_name, last_name, full_name, email, phone (+63…), address, payment_method, notes, items_summary, item_count, subtotal, shipping, total, currency, items[], source, created_at`
