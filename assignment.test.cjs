const fs = require('node:fs');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const file = __dirname + '/creation_tache_automatique_changement_etat_devis.user.js';
const source = fs.readFileSync(file, 'utf8').replace(
    "    document.addEventListener(\n        'click',",
    "    window.testAPI = { getEstimateIdFromForm, readRoleDetailed, readRoleControl, identifyUserText, readAssignmentSnapshot, chooseAssignment, resolveEstimateAssignment, createTask, handleEstimateFormSubmit, resolveNewEstimateContext }; return;\n    document.addEventListener(\n        'click',"
);
const cases = [];
function test(name, run) { cases.push({ name, run }); }
function setup(html) {
    const dom = new JSDOM(html, { url: 'https://courtage.modulr.fr/fr/client.php?id=42', runScripts: 'outside-only' });
    const w = dom.window;
    w.CSS = { escape: value => String(value) };
    w.console = { log() {}, table() {}, warn() {}, error() {} };
    w.document.cookie = 'modulr_user=gkalah';
    const requests = [];
    w.fetch = async (url, options = {}) => {
        requests.push({ url, options });
        return { ok: true, status: 200, url, text: async () => w.document.documentElement.outerHTML };
    };
    w.eval(source);
    return { w, api: w.testAPI, requests, close: () => w.close() };
}
const card = content => '<div class="card" id="element_toggle_estimate_123">' + content + '</div>';
const field = (role, value) => '<input name="estimate[' + role + '_user_id]" value="' + value + '">';
const pair = (ref, bin) => field('referent', ref) + field('binome', bin);

test('selected Louli after Ghais and Jake in option order', async () => {
    const ctx = setup(card('<label>Référent</label><select name="owner"><option value="24">Ghais</option><option value="28">Jake</option><option value="36" selected>Louli</option></select>' + field('binome', '28')));
    try {
        const result = await ctx.api.resolveEstimateAssignment({ estimateId: '123' });
        assert.equal(result.userId, '36');
        await ctx.api.createTask({ statusKey: 'pricing', clientId: '42', userId: result.userId }, '123');
        const post = ctx.requests.find(r => r.options.method === 'POST');
        assert.equal(new URLSearchParams(post.options.body).get('task_actors_list_id'), 'user:36');
    } finally { ctx.close(); }
});
test('referent Louli wins over binome Jake and connected Ghais', async () => {
    const ctx = setup(card(pair('36', '28')));
    try { assert.equal((await ctx.api.resolveEstimateAssignment({ estimateId: '123' })).userId, '36'); }
    finally { ctx.close(); }
});
test('empty referent chooses binome Jake', async () => {
    const ctx = setup(card(pair('', '28')));
    try { assert.equal((await ctx.api.resolveEstimateAssignment({ estimateId: '123' })).userId, '28'); }
    finally { ctx.close(); }
});
test('connected user only after both roles confirmed empty', async () => {
    const ctx = setup(card(pair('', '')));
    try { assert.equal((await ctx.api.resolveEstimateAssignment({ estimateId: '123' })).userId, '24'); }
    finally { ctx.close(); }
});
test('unreadable referent blocks binome and connected fallback', async () => {
    const ctx = setup(card(field('binome', '28')));
    try {
        await assert.rejects(ctx.api.resolveEstimateAssignment({ estimateId: '123', timeoutMs: 200 }), /non confirmé/);
        assert.equal(ctx.requests.filter(r => r.options.method === 'POST').length, 0);
    } finally { ctx.close(); }
});
test('delayed Louli waits rather than choosing Jake or connected user', async () => {
    const ctx = setup(card('<select name="estimate[referent_user_id]"><option value="">Chargement</option></select>' + field('binome', '28')));
    try {
        ctx.w.setTimeout(() => {
            const el = ctx.w.document.querySelector('select');
            el.innerHTML = '<option value="24">Ghais</option><option value="36" selected>Louli</option>';
        }, 900);
        assert.equal((await ctx.api.resolveEstimateAssignment({ estimateId: '123', timeoutMs: 2500 })).userId, '36');
    } finally { ctx.close(); }
});
test('list loading times out without sending a task', async () => {
    const ctx = setup(card('<select name="estimate[referent_user_id]"><option value="">Chargement</option></select>' + field('binome', '28')));
    try {
        await assert.rejects(ctx.api.resolveEstimateAssignment({ estimateId: '123', timeoutMs: 200 }), /non confirmé/);
        assert.equal(ctx.requests.filter(r => r.options.method === 'POST').length, 0);
    } finally { ctx.close(); }
});
test('mixed text never depends on collaborator array order', () => {
    const ctx = setup('');
    try { assert.equal(ctx.api.identifyUserText('Ghais Jake Louli'), ''); }
    finally { ctx.close(); }
});
test('another estimate and previous task cannot supply the referent', () => {
    const ctx = setup(card(field('binome', '28')) +
        '<div class="card" id="element_toggle_estimate_456">' + pair('24', '22') + '</div>' +
        '<div class="task"><label>Référent</label><span>Ghais</span></div>');
    try { assert.equal(ctx.api.readAssignmentSnapshot(ctx.w.document, '123').referent.state, 'unknown'); }
    finally { ctx.close(); }
});
test('explicit client roles outside estimate card are read', async () => {
    const ctx = setup('<section><label>Référent</label><span>Louli Vulliod</span><label>Binôme</label><span>Jake Casimir</span></section>' + card('Devis'));
    try { assert.equal((await ctx.api.resolveEstimateAssignment({ estimateId: '123' })).userId, '36'); }
    finally { ctx.close(); }
});
test('form modification uses binome when form referent is explicitly empty', async () => {
    const ctx = setup(card('<form>' + pair('', '28') + '</form>'));
    try {
        const result = await ctx.api.resolveEstimateAssignment({ estimateId: '123', form: ctx.w.document.querySelector('form') });
        assert.equal(result.userId, '28');
    } finally { ctx.close(); }
});
test('fresh page with assigned Louli prevents empty live fields fallback', async () => {
    const ctx = setup(card(pair('', '')));
    ctx.w.fetch = async url => ({ ok: true, url, text: async () => card(pair('36', '28')) });
    try { assert.equal((await ctx.api.resolveEstimateAssignment({ estimateId: '123' })).userId, '36'); }
    finally { ctx.close(); }
});
test('unknown role after refresh failure cannot fallback', async () => {
    const ctx = setup(card(field('binome', '28')));
    ctx.w.fetch = async () => { throw new Error('HTTP 500'); };
    try { await assert.rejects(ctx.api.resolveEstimateAssignment({ estimateId: '123', timeoutMs: 200 }), /non confirmé/); }
    finally { ctx.close(); }
});
test('inline role labels assign Louli regardless of other names in card', async () => {
    const ctx = setup(card('<p>Référent : Louli</p><p>Binôme : Jake</p><p>Ancienne tâche Ghais</p>'));
    try { assert.equal((await ctx.api.resolveEstimateAssignment({ estimateId: '123' })).userId, '36'); }
    finally { ctx.close(); }
});
test('existing form handler posts Jake before native submit', async () => {
    const ctx = setup(card('<form><input name="estimate[id]" value="123"><input name="estimate[client_id]" value="42"><input name="estimate[status]" value="pricing">' + pair('', '28') + '</form>'));
    let submitted = false;
    ctx.w.HTMLFormElement.prototype.submit = function() {
        const post = ctx.requests.find(r => r.options.method === 'POST');
        assert.ok(post);
        assert.equal(new URLSearchParams(post.options.body).get('task_actors_list_id'), 'user:28');
        submitted = true;
    };
    ctx.w.alert = message => { throw new Error(message); };
    try {
        await ctx.api.handleEstimateFormSubmit(ctx.w.document.querySelector('form'), null,
            { preventDefault() {}, stopImmediatePropagation() {}, type: 'submit' });
        assert.equal(submitted, true);
    } finally { ctx.close(); }
});
test('new estimate uses selected Louli from form', async () => {
    const ctx = setup('<form>' + pair('36', '28') + '</form>');
    try {
        const result = await ctx.api.resolveNewEstimateContext({
            idsBefore: new Set(), nativeResult: { finalUrl: 'https://courtage.modulr.fr/fr/client.php?id=42&estimate_id=123', html: card(pair('36', '28')) },
            referentFromForm: ctx.api.readRoleDetailed(ctx.w.document.querySelector('form'), 'referent'),
            form: ctx.w.document.querySelector('form')
        });
        assert.equal(result.userId, '36');
        assert.equal(result.estimateId, '123');
    } finally { ctx.close(); }
});
test('new estimate reads response roles when form has no roles', async () => {
    const ctx = setup('<form></form>');
    try {
        const result = await ctx.api.resolveNewEstimateContext({
            idsBefore: new Set(), nativeResult: { finalUrl: 'https://courtage.modulr.fr/fr/client.php?id=42&estimate_id=123', html: card(pair('36', '28')) },
            referentFromForm: ctx.api.readRoleDetailed(ctx.w.document.querySelector('form'), 'referent'),
            form: ctx.w.document.querySelector('form')
        });
        assert.equal(result.userId, '36');
    } finally { ctx.close(); }
});
test('live loading field cannot be replaced by a default from refreshed HTML', async () => {
    const ctx = setup(card('<select name="estimate[referent_user_id]"><option value="">Chargement</option></select>' + field('binome', '28')));
    ctx.w.fetch = async url => ({ ok: true, url, text: async () => card(pair('24', '28')) });
    try {
        ctx.w.setTimeout(() => {
            ctx.w.document.querySelector('select').innerHTML = '<option value="36" selected>Louli</option>';
        }, 900);
        assert.equal((await ctx.api.resolveEstimateAssignment({ estimateId: '123', timeoutMs: 2500 })).userId, '36');
    } finally { ctx.close(); }
});
test('creation ID zero never inherits another estimate from the page', () => {
    const ctx = setup('<section>' + card(pair('24', '28')) + '<form action="?id=42&estimate_id=0"></form></section>');
    try { assert.equal(ctx.api.getEstimateIdFromForm(ctx.w.document.querySelector('form')), ''); }
    finally { ctx.close(); }
});
test('explicit existing form ID still wins over creation URL', () => {
    const ctx = setup('<form action="?id=42&estimate_id=0"><input name="estimate[id]" value="456"></form>');
    try { assert.equal(ctx.api.getEstimateIdFromForm(ctx.w.document.querySelector('form')), '456'); }
    finally { ctx.close(); }
});
test('new estimate cannot use an existing ID from redirect URL', async () => {
    const ctx = setup('<form>' + pair('36', '28') + '</form>');
    try {
        const result = await ctx.api.resolveNewEstimateContext({
            idsBefore: new Set(['123']), nativeResult: {
                finalUrl: 'https://courtage.modulr.fr/fr/client.php?id=42&estimate_id=123',
                html: '<div id="element_toggle_estimate_456"></div>'
            }, form: ctx.w.document.querySelector('form')
        });
        assert.equal(result.estimateId, '456');
    } finally { ctx.close(); }
});
test('unknown assignee on new estimate blocks saving and explains stage', async () => {
    const ctx = setup('<form action="?id=42&estimate_id=0" method="post"><input name="estimate[client_id]" value="42"><input name="estimate[status]" value="pricing"></form>');
    let message = '';
    ctx.w.alert = value => { message = value; };
    try {
        await ctx.api.handleEstimateFormSubmit(ctx.w.document.querySelector('form'), null,
            { preventDefault() {}, stopImmediatePropagation() {}, type: 'submit' });
        assert.equal(ctx.requests.filter(r => r.options.method === 'POST').length, 0);
        assert.match(message, /avant enregistrement/);
        assert.match(message, /Référent ou binôme non confirmé/);
        assert.match(message, /Aucun enregistrement/);
    } finally { ctx.close(); }
});
test('new form with known Louli saves then creates task on new ID', async () => {
    const ctx = setup('<section>' + card(pair('24', '28')) + '<form action="?id=42&estimate_id=0" method="post"><input name="estimate[client_id]" value="42"><input name="estimate[status]" value="pricing">' + pair('36', '28') + '</form></section>');
    let alert = '';
    ctx.w.alert = value => { alert = value; };
    ctx.w.fetch = async (url, options = {}) => {
        ctx.requests.push({ url, options });
        return { ok: true, status: 200,
            url: 'https://courtage.modulr.fr/fr/client.php?id=42',
            text: async () => card(pair('24', '28')) + '<div class="card" id="element_toggle_estimate_456">' + pair('36', '28') + '</div>' };
    };
    try {
        await ctx.api.handleEstimateFormSubmit(ctx.w.document.querySelector('form'), null,
            { preventDefault() {}, stopImmediatePropagation() {}, type: 'submit' });
        const posts = ctx.requests.filter(r => r.options.method === 'POST');
        assert.equal(posts.length, 2);
        assert.ok(posts[0].options.body instanceof ctx.w.FormData);
        const task = new URLSearchParams(posts[1].options.body);
        assert.equal(task.get('task_actors_list_id'), 'user:36');
        assert.equal(task.get('selected_subentity_id'), 'EstimateData:456');
        assert.equal(alert, '');
    } finally { ctx.close(); }
});
(async () => {
    for (const {name, run} of cases) {
        await run();
        console.log('PASS ' + name);
    }
    console.log(cases.length + ' tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
