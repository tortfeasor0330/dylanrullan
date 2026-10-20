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

Redeploy after adding or changing a variable.

### Booking webhook fields
`event, ref, status, status_label, first_name, last_name, full_name, email, phone (+63…), date_of_birth, appointment_type, appointment_type_label, duration_min, format, video_platform, date, time, date_label, time_label, start_iso, timezone, concern, notes, fee, currency, payment_method, payment_ref, has_payment_screenshot, admin_url, source, created_at, updated_at`

### Order webhook fields
`event, ref, status, first_name, last_name, full_name, email, phone (+63…), address, payment_method, notes, items_summary, item_count, subtotal, shipping, total, currency, items[], source, created_at`
