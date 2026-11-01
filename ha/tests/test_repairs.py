"""A watch not heard from in 30 days gets a Repairs notice that removes it (and its token)."""

from datetime import timedelta
from http import HTTPStatus

from freezegun.api import FrozenDateTimeFactory
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import issue_registry as ir
from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.kestrel.const import DOMAIN, QUIET_CHECK_EVERY, TOKEN_HEADER
from custom_components.kestrel.repairs import (
    async_check_quiet,
    async_create_fix_flow,
    issue_id,
)


async def _pair(hass, client, name):
    res = await client.post("/api/kestrel/pair", json={"watch_name": name})
    pairing_id = (await res.json())["pairing_id"]
    code = hass.config_entries.async_loaded_entries(DOMAIN)[0].runtime_data.pairings[pairing_id].code
    res = await client.post("/api/kestrel/pair/confirm", json={"pairing_id": pairing_id, "code": code})
    return await res.json()


async def _fix(hass, iid):
    issue = ir.async_get(hass).async_get_issue(DOMAIN, iid)
    flow = await async_create_fix_flow(hass, iid, issue.data)
    flow.hass = hass
    return flow


async def test_a_quiet_watch_gets_a_notice_that_removes_it(
    hass, setup_entry, hass_client_no_auth, freezer: FrozenDateTimeFactory
):
    watches = setup_entry.runtime_data
    client = await hass_client_no_auth()
    old = await _pair(hass, client, "Old watch")
    used = await _pair(hass, client, "Daily watch")
    await client.get("/api/kestrel/sync", headers={TOKEN_HEADER: old["token"]})

    freezer.tick(timedelta(days=29))
    await client.get("/api/kestrel/sync", headers={TOKEN_HEADER: used["token"]})
    async_check_quiet(hass, setup_entry)
    assert not [i for i in ir.async_get(hass).issues if i[0] == DOMAIN]

    # 31 days after the old watch was last seen (2 days after the daily one): found by the periodic check
    freezer.tick(timedelta(days=2))
    async_fire_time_changed(hass)
    freezer.tick(timedelta(seconds=QUIET_CHECK_EVERY))
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    issue = ir.async_get(hass).async_get_issue(DOMAIN, issue_id(old["watch_id"]))
    assert issue is not None and issue.is_fixable
    assert issue.translation_placeholders == {"watch": "Old watch", "days": "31", "limit": "30"}
    assert ir.async_get(hass).async_get_issue(DOMAIN, issue_id(used["watch_id"])) is None

    flow = await _fix(hass, issue_id(old["watch_id"]))
    form = await flow.async_step_init()
    assert form["type"] is FlowResultType.FORM and form["description_placeholders"] == {"watch": "Old watch"}
    done = await flow.async_step_confirm({})
    assert done["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()

    assert list(watches.watches) == [used["watch_id"]]
    assert dr.async_get(hass).async_get_device_by_identifier((DOMAIN, old["watch_id"]), setup_entry.entry_id) is None
    res = await client.get("/api/kestrel/sync", headers={TOKEN_HEADER: old["token"]})
    assert res.status == HTTPStatus.UNAUTHORIZED  # its token no longer works
    assert ir.async_get(hass).async_get_issue(DOMAIN, issue_id(old["watch_id"])) is None
    # a second click on a stale notice: nothing left to remove
    flow.watch_id = old["watch_id"]
    assert (await flow.async_step_confirm())["type"] is FlowResultType.ABORT


async def test_a_watch_never_seen_counts_from_pairing_and_the_notice_clears_when_it_is_used(
    hass, setup_entry, hass_client_no_auth, freezer: FrozenDateTimeFactory
):
    client = await hass_client_no_auth()
    watch = await _pair(hass, client, "Test install")
    freezer.tick(timedelta(days=30, minutes=1))
    async_check_quiet(hass, setup_entry)
    assert ir.async_get(hass).async_get_issue(DOMAIN, issue_id(watch["watch_id"])) is not None

    # used again: the notice goes at once
    await client.get("/api/kestrel/sync", headers={TOKEN_HEADER: watch["token"]})
    assert ir.async_get(hass).async_get_issue(DOMAIN, issue_id(watch["watch_id"])) is None


async def test_notices_go_with_their_watch_or_the_integration(
    hass, setup_entry, hass_client_no_auth, freezer: FrozenDateTimeFactory
):
    watches = setup_entry.runtime_data
    client = await hass_client_no_auth()
    a = await _pair(hass, client, "A")
    b = await _pair(hass, client, "B")
    freezer.tick(timedelta(days=40))
    async_check_quiet(hass, setup_entry)
    assert len([i for i in ir.async_get(hass).issues if i[0] == DOMAIN]) == 2

    # removed another way (its device deleted): its notice goes too
    await watches.async_remove([a["watch_id"]])
    assert ir.async_get(hass).async_get_issue(DOMAIN, issue_id(a["watch_id"])) is None
    # a notice whose watch vanished without passing through async_remove is dropped at the next check
    ir.async_create_issue(
        hass, DOMAIN, issue_id("gone"), is_fixable=True, severity=ir.IssueSeverity.WARNING, translation_key="quiet_watch"
    )
    async_check_quiet(hass, setup_entry)
    assert ir.async_get(hass).async_get_issue(DOMAIN, issue_id("gone")) is None

    # a fix for an entry that no longer exists aborts
    flow = await async_create_fix_flow(hass, issue_id(b["watch_id"]), {"entry_id": "nope", "watch_id": b["watch_id"]})
    flow.hass = hass
    assert (await flow.async_step_init())["type"] is FlowResultType.ABORT

    # removing the integration takes its notices with it
    assert await hass.config_entries.async_remove(setup_entry.entry_id)
    await hass.async_block_till_done()
    assert not [i for i in ir.async_get(hass).issues if i[0] == DOMAIN]
