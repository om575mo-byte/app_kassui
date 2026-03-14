import urllib.request
import re

water_url = "https://www1.river.go.jp/cgi-bin/SrchWaterData.exe?ID=302021282206050&KIND=3&PAGE=0"
req_water = urllib.request.Request(water_url)
with urllib.request.urlopen(req_water) as response:
    html_water = response.read().decode('euc-jp', errors='replace')

print(html_water[:1000])
