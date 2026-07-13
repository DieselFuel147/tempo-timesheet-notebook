import re
from datetime import datetime, timedelta
import requests

# ======================
# CONFIG
# ======================

DEFAULT_TICKET = "ADMIN-TICKET"

TEMPO_API_URL = "https://api.tempo.io/4/worklogs"
TOKEN = "YOUR_TEMPO_API_TOKEN"  # replace later


# ======================
# HELPERS
# ======================

def is_valid_ticket(text):
    return re.fullmatch(r"[A-Z][A-Z0-9]*-\d+", text or "")


def normalize_ticket(raw):
    if not raw:
        return DEFAULT_TICKET, True

    raw = raw.strip()

    if raw == "DEVADMIN":
        return DEFAULT_TICKET, True

    if is_valid_ticket(raw):
        return raw, False

    return DEFAULT_TICKET, True

def normalize_time(time_str):
    if ":" not in time_str:
        time_str += ":00"

    hour, minute = map(int, time_str.split(":"))

    if 1 <= hour <= 6:
        hour += 12

    return f"{hour:02d}:{minute:02d}"


def parse_date(date_str):
    # format: 9/05 → assume current year
    return datetime.strptime(date_str + f"/{datetime.now().year}", "%d/%m/%Y")


def duration_seconds(start, end):
    fmt = "%H:%M"

    start_dt = datetime.strptime(start, fmt)
    end_dt = datetime.strptime(end, fmt)

    delta = end_dt - start_dt

    if delta.total_seconds() <= 0:
        raise ValueError(
            f"End time ({end}) must be after start time ({start})"
        )

    return int(delta.total_seconds())

def is_lunch(text):
    return text and "lunch" in text.lower()

def validate_entries(entries):
    warnings = []
    errors = []

    MAX_ENTRY_HOURS = 8

    for entry in entries:
        duration_hours = entry["seconds"] / 3600

        if duration_hours > MAX_ENTRY_HOURS:
            warnings.append(
                f"{entry['date'].strftime('%d/%m')} "
                f"{entry['start']}-{entry['end']} "
                f"({duration_hours:.2f}h) exceeds "
                f"{MAX_ENTRY_HOURS}h"
            )

        if not is_valid_ticket(entry["ticket"]):
            errors.append(
                f"{entry['date'].strftime('%d/%m')} "
                f"{entry['start']}-{entry['end']} "
                f"invalid ticket: {entry['ticket']}"
            )

    return warnings, errors

def validate_daily_totals(entries):
    warnings = []

    daily_totals = {}

    for entry in entries:
        day = entry["date"].strftime("%Y-%m-%d")

        daily_totals.setdefault(day, 0)
        daily_totals[day] += entry["seconds"]

    for day, seconds in daily_totals.items():
        hours = seconds / 3600

        if hours > 12:
            warnings.append(
                f"{day} contains {hours:.2f}h logged"
            )

        if hours < 4:
            warnings.append(
                f"{day} contains only {hours:.2f}h logged"
            )

    return warnings

def validate_overlaps(entries):
    warnings = []

    by_day = {}

    for entry in entries:
        day = entry["date"].strftime("%Y-%m-%d")
        by_day.setdefault(day, []).append(entry)

    for day, day_entries in by_day.items():

        sorted_entries = sorted(
            day_entries,
            key=lambda x: x["start"]
        )

        for i in range(len(sorted_entries) - 1):
            current = sorted_entries[i]
            next_entry = sorted_entries[i + 1]

            if current["end"] > next_entry["start"]:
                warnings.append(
                    f"Overlap on {day}: "
                    f"{current['start']}-{current['end']} "
                    f"and "
                    f"{next_entry['start']}-{next_entry['end']}"
                )

    return warnings

# ======================
# PARSER (STATE MACHINE)
# ======================

def parse_markdown(file_path):
    entries = []
    lunch_entries = []

    with open(file_path, "r") as f:
        lines = [l.strip() for l in f.readlines()]

    current_date = None
    i = 0

    while i < len(lines):
        line = lines[i]

        # Detect date
        date_match = re.match(r"##+ (\d{1,2}/\d{2})", line)
        if date_match:
            current_date = parse_date(date_match.group(1))
            i += 1
            continue

        # Detect time range
        time_match = re.match(
            r"(\d{1,2}(?::\d{2})?)\s*-\s*(\d{1,2}(?::\d{2})?)",
            line
        )
        if time_match and current_date:
            raw_start, raw_end = time_match.groups()

            start = normalize_time(raw_start)
            end = normalize_time(raw_end)

            ticket = None
            description = ""

            # next line = ticket or description
            if i + 1 < len(lines):
                next_line = lines[i + 1]

                if is_valid_ticket(next_line) or next_line in ["DEVADMIN", "?"]:
                    ticket = next_line
                    i += 1

                    # description = next line only
                    if i + 1 < len(lines):
                        description = lines[i + 1]
                        i += 1
                else:
                    description = next_line
                    i += 1

            norm_ticket, inferred = normalize_ticket(ticket)

            if is_lunch(ticket) or is_lunch(description):
                lunch_entries.append({
                    "date": current_date,
                    "start": start,
                    "end": end
                })
                continue            

            entries.append({
                "date": current_date,
                "start": start,
                "end": end,
                "ticket": norm_ticket,
                "description": description,
                "seconds": duration_seconds(start, end),
                "inferred": inferred,
                "raw_ticket": ticket
            })

        i += 1

    return entries, lunch_entries


# ======================
# SUMMARY
# ======================

def print_summary(entries):
    print("\n======== SUMMARY ========\n")

    totals = {}
    inferred_entries = []

    for e in entries:
        totals[e["ticket"]] = totals.get(e["ticket"], 0) + e["seconds"]

        if e["inferred"]:
            inferred_entries.append(e)

    print("✅ Totals:\n")
    for ticket, sec in totals.items():
        print(f"{ticket}: {round(sec / 3600, 2)}h")

    print("\n⚠️ Inferred entries:\n")
    for e in inferred_entries:
        print(f"{e['date'].strftime('%d/%m')} {e['start']}-{e['end']} → {e['ticket']}")

    print("\n=========================\n")


# ======================
# TEMPO API
# ======================

def send_to_tempo(entries):
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json"
    }

    for e in entries:
        payload = {
            "issueKey": e["ticket"],
            "timeSpentSeconds": e["seconds"],
            "startDate": e["date"].strftime("%Y-%m-%d"),
            "startTime": e["start"] + ":00",
            "description": e["description"]
        }

        print(f"Sending → {e['ticket']} {e['start']} {e['description']}")

        # Uncomment when ready
        # response = requests.post(TEMPO_API_URL, json=payload, headers=headers)
        # print(response.status_code, response.text)


# ======================
# MAIN CLI
# ======================

def main():
    import sys

    if len(sys.argv) < 2:
        print("Usage: python tempo_cli.py <file.md>")
        return

    file_path = sys.argv[1]

    entries, lunch_entries = parse_markdown(file_path)

    print(f"\nParsed {len(entries)} entries\n")
    print(f"Skipped lunch entries: {len(lunch_entries)}")

    for e in entries:
        print(e)

    print_summary(entries)

    warnings, errors = validate_entries(entries)
    warnings.extend(validate_daily_totals(entries))
    warnings.extend(validate_overlaps(entries))

    if warnings:
        print("\n⚠ WARNINGS")
        for w in warnings:
            print(" -", w)

    if errors:
        print("\n❌ ERRORS")
        for e in errors:
            print(" -", e)

        print("\nSubmission blocked.")
        return    

    confirm = input("Submit to Tempo? (upload/cancel): ")

    if confirm.lower() == "upload":
        send_to_tempo(entries)
    else:
        print("Cancelled.")


if __name__ == "__main__":
    main()