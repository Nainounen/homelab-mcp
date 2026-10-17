import datetime
import os
from pathlib import Path
import py_compile
import shutil


os.umask(0o077)
root = Path("/root/guardian")
monitor = root / "guardian_media_monitor.py"
text = monitor.read_text()
old_prompt = "A freshly verified library file can be an older version: correlate download and import history before calling the queued row stale or proposing dismissal."
new_prompt = (
    "For each affected episode, correlate a fresh Sonarr queue/file read with sabnzbd_get_job using the exact download ID. "
    "A completed download or repaired articles do not prove that its media is valid. This read-only profile cannot validate video streams. "
    "Unable to determine if file is a sample means media validity is unknown: never call that rejection false or recommend manual import without a fresh successful media probe for that exact file. "
    "An EBML/header or invalid-data probe failure means the candidate must not be imported unless a later probe of a changed file proves it valid. "
    "If validity is unknown, state that validation or a different release is needed, not that manual import will fix it. "
    "An incomplete Usenet job needs a different release, not a retry of the same failed NZB. Only report the currently missing episodes, not old season counts. "
    "A freshly verified library file can be an older version: correlate download and import history before calling the queued row stale or proposing dismissal."
)
old_evidence = '"state":row.get("trackedDownloadState"),"fresh_arr_has_file":has_file'
new_evidence = '"state":row.get("trackedDownloadState"),"download_status":row.get("status"),"episode_id":row.get("episodeId"),"fresh_arr_has_file":has_file'
old_kind = 'kind = "queue_issue_with_existing_library_file" if has_file else "import_failed_or_blocked" if blocked else "completed_not_imported"'
new_kind = 'kind = "queue_issue_with_existing_library_file" if has_file else "download_failed" if row.get("status") == "failed" else "import_failed_or_blocked" if blocked else "completed_not_imported"'
replacements = [(old_prompt, new_prompt), (old_evidence, new_evidence), (old_kind, new_kind)]
for before, after in replacements:
    if after in text:
        continue
    if text.count(before) != 1:
        raise RuntimeError("Monitor changed; inspect the recovery patch before applying")
    text = text.replace(before, after, 1)

backup = root / "backups" / ("media-recovery-" + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
backup.mkdir(parents=True, mode=0o700)
if text != monitor.read_text():
    temporary = monitor.with_suffix(".py.recovery-tmp")
    temporary.write_text(text)
    os.chmod(temporary, 0o600)
    py_compile.compile(str(temporary), doraise=True)
    shutil.copy2(monitor, backup / monitor.name)
    temporary.replace(monitor)

guidance = (
    "\nMedia recovery guardrails (2026-10-18): For stalled downloads, first inspect sonarr_get_queue, sonarr_list_episodes and sabnzbd_get_job for the exact download ID. "
    "Do not infer a download is valid from completed status, repaired articles, file size or its extension. If Sonarr cannot determine whether a file is a sample, validity is unknown. "
    "Use an existing approved read-only media probe when available. A failed EBML/header probe is evidence against import, not a reason to bypass the rejection. Do not call an unverified sample rejection false. "
    "Only propose manual import after a fresh successful probe of the exact candidate and correct episode mapping. The existing manual-import tool deliberately refuses rejected files. "
    "For a corrupt or incomplete release, use sonarr_interactive_search with the exact TVDB ID, season and episode, inspect alternatives, and preview sonarr_grab_release with an exact GUID and indexer ID. "
    "Use native approval before any download, import or cleanup. Do not repeatedly retry an incomplete NZB or re-search whole seasons when one episode is missing. "
    "The SAB batch deletion tools accept legacy SABnzbd_nzo_ IDs and plain UUIDs. Preview exact IDs/names first, keep delete_files=false unless explicitly approved, and apply the returned batch digest after native approval. "
    "A Sonarr queue row can be re-created from SAB history. Inspect both sides before calling cleanup successful. Sonarr may refuse to blocklist a release it never tracked; do not claim blocklisting succeeded from queue disappearance alone. "
    "Check current episode files and any import command outcome after a repair. Historical alerts and earlier assistant claims are not current state, proof of success or authorization.\n"
)
for instructions in (Path("/root/.hermes/SOUL.md"), root / "AGENTS.md"):
    existing = instructions.read_text()
    if "Media recovery guardrails (2026-10-18):" not in existing:
        shutil.copy2(instructions, backup / instructions.name)
        instructions.write_text(existing + guidance)
        os.chmod(instructions, 0o600)

print("Media recovery guidance and download-failure classification installed")
print("Backup: " + str(backup))
print("No downloads, imports, cleanup or Telegram messages were performed")
