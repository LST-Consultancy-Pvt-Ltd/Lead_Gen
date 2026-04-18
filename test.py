import requests
import json
from dotenv import load_dotenv
load_dotenv()
import os
 
API_KEY = os.getenv("APOLLO_API_KEY", "q1P5BVUCIdck5Zi0YTofVw")
BASE_URL = "https://api.apollo.io/api/v1/"
 
headers = {
    "accept": "application/json",
    "Cache-Control": "no-cache",
    "Content-Type": "application/json",
    "x-api-key": API_KEY,
}
 
 
def enrich_organization(domain: str):
    """Get Apollo Org ID + company info from domain. FREE."""
    response = requests.get(
        f"{BASE_URL}organizations/enrich",
        headers=headers,
        params={"domain": domain},
    )
    data = response.json()
    org = data.get("organization", {})
 
    if not org:
        print(f"No organization found for domain: {domain}")
        return None
 
    print(f"\n[Org Enrichment] {domain}")
    print(f"  Company     : {org.get('name', 'N/A')}")
    print(f"  Industry    : {org.get('industry', 'N/A')}")
    print(f"  Employees   : {org.get('estimated_num_employees', 'N/A')}")
    print(f"  Phone       : {org.get('sanitized_phone', 'N/A')}")
    print(f"  LinkedIn    : {org.get('linkedin_url', 'N/A')}")
    print(f"  Website     : {org.get('website_url', 'N/A')}")
    print(f"  HQ          : {org.get('city', 'N/A')}, {org.get('state', 'N/A')}, {org.get('country', 'N/A')}")
    print(f"  Apollo OrgID: {org.get('id', 'N/A')}")
 
    return org
 
 
def search_people_by_org_id(org_id: str, job_title: str = None, per_page: int = 10):
    """
    Search people using Apollo's internal Org ID.
    This is more reliable than domain search for small companies.
    FREE — no credits consumed.
    """
    payload = {
        "organization_ids": [org_id],          # ← use org ID, not domain
        "per_page": per_page,
        "page": 1,
    }
 
    if job_title:
        payload["person_titles"] = [job_title]
        payload["include_similar_titles"] = True
 
    response = requests.post(
        f"{BASE_URL}mixed_people/api_search",
        headers=headers,
        json=payload,
    )
 
    data = response.json()
 
    # debug: uncomment if still empty
    # print(json.dumps(data, indent=2))
 
    people = data.get("people", [])
    print(f"\n[People Search] org_id={org_id} → {len(people)} people found\n")
 
    results = []
    for person in people:
        entry = {
            "apollo_id":  person.get("id"),
            "first_name": person.get("first_name", "N/A"),
            "last_name":  person.get("last_name_obfuscated", "N/A"),
            "title":      person.get("title", "N/A"),
            "company":    (person.get("organization") or {}).get("name", "N/A"),
            "has_email":  person.get("has_email", False),
            "linkedin":   person.get("linkedin_url", "N/A"),
        }
        results.append(entry)
        print(f"  {entry['first_name']} {entry['last_name']} | {entry['title']} @ {entry['company']}")
        print(f"  has_email: {entry['has_email']} | Apollo ID: {entry['apollo_id']}")
        print()
 
    return results
 
 
def enrich_person_by_id(apollo_id: str):
    """Unlock full name + email for one person. COSTS 1 CREDIT."""
    payload = {
        "id": apollo_id,
        "reveal_personal_emails": False,
        "reveal_phone_number": False,
    }
    response = requests.post(f"{BASE_URL}people/match", headers=headers, json=payload)
    person = response.json().get("person", {})
 
    if not person:
        print(f"No enrichment result for ID: {apollo_id}")
        return None
 
    org = person.get("organization") or {}
    print(f"\n  ✓ {person.get('first_name')} {person.get('last_name')}")
    print(f"    Email   : {person.get('email', 'N/A')}")
    print(f"    Title   : {person.get('title', 'N/A')}")
    print(f"    Company : {org.get('name', 'N/A')}")
    print(f"    LinkedIn: {person.get('linkedin_url', 'N/A')}")
    print(f"    Phone   : {person.get('sanitized_phone', 'N/A')}")
    print(f"    Location: {person.get('city', '')}, {person.get('state', '')}, {person.get('country', '')}")
    return person
 
 
def bulk_enrich(apollo_ids: list):
    """Enrich up to 10 people in one call. COSTS 1 CREDIT EACH."""
    payload = {
        "details": [{"id": aid} for aid in apollo_ids],
        "reveal_personal_emails": False,
        "reveal_phone_number": False,
    }
    response = requests.post(f"{BASE_URL}people/bulk_match", headers=headers, json=payload)
    matches = response.json().get("matches", [])
 
    results = []
    print(f"\n{'Name':<25} {'Email':<35} {'Title':<30} {'Company'}")
    print("-" * 115)
    for person in matches:
        org = person.get("organization") or {}
        name = f"{person.get('first_name', '')} {person.get('last_name', '')}".strip()
        row = {
            "name":     name,
            "email":    person.get("email", "N/A"),
            "title":    person.get("title", "N/A"),
            "company":  org.get("name", "N/A"),
            "linkedin": person.get("linkedin_url", "N/A"),
        }
        results.append(row)
        print(f"{row['name']:<25} {row['email']:<35} {row['title']:<30} {row['company']}")
    return results
 
 
# ─────────────────────────────────────────────────────────────────────────────
# FULL PIPELINE: domain → org ID → people → emails
# ─────────────────────────────────────────────────────────────────────────────
 
def get_contacts_from_domain(domain: str, job_title: str = None, per_page: int = 10, enrich: bool = False):
    """
    Full pipeline:
      1. Enrich domain → get Apollo Org ID        (FREE)
      2. Search people by Org ID                  (FREE)
      3. Optionally bulk enrich for emails        (COSTS CREDITS)
    """
    # Step 1: Get org ID from domain
    org = enrich_organization(domain)
    if not org:
        return []
 
    org_id = org.get("id")
    if not org_id:
        print("Could not get Apollo Org ID.")
        return []
 
    # Step 2: Search people using org ID
    people = search_people_by_org_id(org_id, job_title=job_title, per_page=per_page)
 
    if not people:
        print("No people found for this org.")
        return []
 
    # Step 3: Enrich for emails (only if requested + only those with confirmed emails)
    if enrich:
        ids = [p["apollo_id"] for p in people if p["has_email"]]
        if ids:
            print(f"\n[Bulk Enrichment] Enriching {len(ids)} people with emails...")
            return bulk_enrich(ids)
        else:
            print("None of the found people have confirmed emails.")
 
    return people
 
 
# ─────────────────────────────────────────────────────────────────────────────
# Run
# ─────────────────────────────────────────────────────────────────────────────
 
# Full pipeline — free search only
get_contacts_from_domain("perennialresources.com", job_title="HR Manager", per_page=10, enrich=False)
 
# Full pipeline — with email enrichment (costs credits)
# get_contacts_from_domain("rfpmart.com", job_title="Founder", per_page=10, enrich=True)
 
#enrich_person_by_id("61f38d15729fd10001627bcb")
 
 