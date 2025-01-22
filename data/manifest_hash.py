import json
import hashlib
import urllib.request
from pathlib import Path


# Load the manifest
with open(Path(__file__).parent / "manifest.json") as f:
    data = json.load(f)


output = {}


def hash_file(url):
    print(f"Hashing {url}...", end="", flush=True)
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows; U; Windows NT 5.1; it; rv:1.8.1.11) Gecko/20071127 Firefox/2.0.0.11"
        },
    )

    # Open the URL and save the content to a file
    with urllib.request.urlopen(req) as response:
        data = response.read()

        result = {
            "sha256": hashlib.sha256(data).hexdigest(),
            "md5": hashlib.md5(data).hexdigest(),
        }

    print(f"{result}")
    return result


for packages in data.values():
    for package in packages:
        if "sources" not in package:
            continue

        if isinstance(package["sources"], dict):
            for os, url in package["sources"].items():
                output[url] = hash_file(url)
        else:
            output[package["sources"]] = hash_file(package["sources"])

# Save the manifest
with open(Path(__file__).parent / "manifest_hash.json", "w") as f:
    f.write(json.dumps(output, indent=4))
