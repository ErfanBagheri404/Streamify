import re

path = "components/core/image.ts"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Current broken regex has \\// which is actually \/ in JS source (escaped slash)
# But the patch doubled the backslash escaping making it invalid TS
# We need to fix lines 246 and 251 where the regex is broken
# Original was: /(^|\/)(default|mqdefault|sddefault|hqdefault)\.(jpg|jpeg|webp)/i
# Current is:   /(^|\\//)(default|mqdefault|sddefault|hqdefault)\\.(jpg|jpeg|webp)/i

old_regex_pattern = r'/(^|\\//)(default|mqdefault|sddefault|hqdefault)\\\.(jpg|jpeg|webp)/i'
new_regex_pattern = r'/(^|\/)(default|mqdefault|sddefault|hqdefault)\.(jpg|jpeg|webp)/i'

count = content.count(old_regex_pattern)
print(f"Found {count} occurrences of broken pattern")

content = content.replace(old_regex_pattern, new_regex_pattern)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

# Verify
with open(path, "r", encoding="utf-8") as f:
    lines = f.readlines()
print("Line 246:", lines[245].strip())
print("Line 251:", lines[250].strip())
