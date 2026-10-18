import datetime
import os
from pathlib import Path
import pwd
import shutil


os.umask(0o077)
account = pwd.getpwnam("homelab-mcp")
directory = Path("/var/lib/homelab-mcp/sab-queue-previews")
if directory.is_symlink():
    raise RuntimeError("Snapshot directory must not be a symlink")
directory.mkdir(mode=0o700, exist_ok=True)
os.chown(directory, account.pw_uid, account.pw_gid)
os.chmod(directory, 0o700)

marker = "SAB queue snapshot cleanup and upgrade diagnosis (2026-10-18):"
guidance = (
    "\n" + marker + " Use sabnzbd_clear_queue to clear a whole reviewed queue in one native approval. "
    "Read current SAB status, pause through the approved pause tool if needed, then preview the clear tool without a digest. "
    "Apply with expected_batch_digest from that preview and the same delete_files option. Preview expires after one hour. "
    "The server stores the complete selection and processes exact IDs internally; do not transcribe hundreds of jobs or ask for approval per chunk. "
    "Already absent jobs are skipped, new arrivals excluded, renamed jobs refused. Keep delete_files=false unless file deletion is explicitly approved. "
    "The operation affects queued downloads, not history or jobs already in repair/unpack. Queue pause alone does not prove repair/unpack disk activity has stopped. "
    "Read the returned complete flag, removed_count, already_absent_count, unsubmitted_count and stopped_reason before claiming success. "
    "A timed-out deletion may still be running: do not interpret partial results as an API limit or automatically repeat it. Inspect current state before requesting a new approval. "
    "Existing sabnzbd_delete_queue_items also handles internal chunks under one approval and skips already absent IDs. "
    "Do not claim the bulk limit is 100: explicit batches support 200, and clear_queue captures up to 5000. "
    "For suspected unwanted Sonarr downloads, inspect the exact quality profile's upgradeAllowed, quality cutoff, custom-format cutoff, actual release scores and current episode hasFile. "
    "Positive German or Italian preference alone does not prove a download is an upgrade or explain a backlog. Missing episodes are fills, not upgrades. "
    "Preserve language preferences unless Leo explicitly asks to change them. Distinguish current settings from settings at grab time, manual grabs and existing queued work. "
    "Removing queued jobs does not unmonitor missing episodes or prevent future RSS grabs. Diagnose the trigger and series monitoring before proposing refill prevention.\n"
)
backup = Path("/root/guardian/backups") / ("sab-clear-" + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
for instructions in (Path("/root/.hermes/SOUL.md"), Path("/root/guardian/AGENTS.md")):
    text = instructions.read_text()
    if marker not in text:
        backup.mkdir(mode=0o700, parents=True, exist_ok=True)
        shutil.copy2(instructions, backup / instructions.name)
        instructions.write_text(text + guidance)
        os.chmod(instructions, 0o600)
print("Installed private SAB queue snapshot storage and Hermes cleanup guidance")
print("No queue, profile or download changes performed")
