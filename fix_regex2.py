"""Fix the double-escaped backslashes in image.ts regex patterns."""
import re

path = "components/core/image.ts"

with open(path, "r", encoding="utf-8") as f:
    lines = f.readlines()

# Lines 246 and 251 (0-indexed: 245 and 250) have broken regex
# They currently look like: /(^|\\\\/)(...)\\\\.(...)/i
# They should look like:   /(^|\\/)(...)\\.(...)/i
# In the file, the difference is:
#   BROKEN: two backslashes before / and before .
#   FIXED:  one backslash before / and before .

for i, line in enumerate(lines):
    if i in (245, 250):
        # Replace \\\\ with \\ (halve the backslash count)
        fixed = line.replace("\\\\\\\\/", "\\\\/").replace("\\\\\\\\.", "\\.")
        if fixed != line:
            print(f"Fixed line {i+1}")
        else:
            print(f"No change on line {i+1}: {line.strip()[:80]}")
        lines[i] = fixed

with open(path, "w", encoding="utf-8") as f:
    f.writelines(lines)

# Verify
with open(path, "r", encoding="utf-8") as f:
    verify_lines = f.readlines()
print("Line 246:", verify_lines[245].strip()[:100])
print("Line 251:", verify_lines[250].strip()[:100])
