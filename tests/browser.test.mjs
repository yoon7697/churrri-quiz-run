import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import {runtime} from './runtime.mjs';

const require = createRequire(process.env.QUIZRUN_BROWSER_DEPS || import.meta.url);
const {chromium} = require('playwright');

test('independent Chromium sessions share one real room and solo still opens', {timeout: 40_000}, async () => {
  const mf = runtime();
  const browsers = [];
  try {
    const origin = (await mf.ready).origin;
    const launch = async () => {
      const browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH || undefined,
        args: ['--no-sandbox'],
      });
      browsers.push(browser);
      return browser;
    };
    const [teacherBrowser, studentBrowser] = await Promise.all([launch(),launch()]);
    const teacher = await teacherBrowser.newPage({viewport:{width:1120,height:950}});
    const student = await studentBrowser.newPage({viewport:{width:780,height:880}, hasTouch:true});
    const other = await studentBrowser.newPage();
    for (const page of [teacher, student, other]) page.setDefaultTimeout(6_000);

    await teacher.goto(origin+'/#online-teacher');
    await teacher.getByRole('button',{name:'온라인 방 생성'}).click();
    await teacher.getByText('실시간 연결됨',{exact:true}).waitFor();
    const code = await teacher.locator('#online-code').innerText();
    assert.match(code, /^[1-9]\d{3}$/);
    const invite = await teacher.getByRole('link',{name:'학생 참가 링크 열기'}).getAttribute('href');
    assert.equal(invite,origin+'/#online-join/'+code);
    const qr = teacher.getByRole('img',{name:'학생 참가 링크 QR코드'});
    assert.match(await qr.getAttribute('src'),/^data:image\/gif;base64,/);
    assert.ok(await qr.evaluate(img => img.complete && img.naturalWidth>0));

    await student.goto(invite);
    assert.equal(await student.getByLabel('방 코드').inputValue(),code);
    await student.getByLabel('닉네임').fill('보라 토끼');
    await student.getByRole('button',{name:'온라인 입장'}).click();
    await teacher.getByLabel('보라 토끼 닉네임').waitFor();
    await student.getByText('1 / 30명',{exact:true}).waitFor();

    await other.goto(origin+'/#online-join');
    await other.getByLabel('방 코드').fill(code==='9999'?'9998':'9999');
    await other.getByLabel('닉네임').fill('민트 토끼');
    await other.getByRole('button',{name:'온라인 입장'}).click();
    await other.getByRole('alert').getByText(/방을 찾을 수 없어요/).waitFor();
    await other.getByLabel('방 코드').fill(code);
    await other.getByLabel('캐릭터 색상').selectOption('2');
    await other.getByRole('button',{name:'온라인 입장'}).click();
    for (const page of [teacher,student,other]) await page.getByText('2 / 30명',{exact:true}).waitFor();
    const firstArena=student.frameLocator('iframe[title="온라인 3D 대기실 경기장"]');
    const secondArena=other.frameLocator('iframe[title="온라인 3D 대기실 경기장"]');
    await firstArena.getByText('민트 토끼',{exact:true}).waitFor({state:'attached'});
    const remote=secondArena.getByText('보라 토끼',{exact:true});
    await remote.waitFor({state:'visible'});
    const before=await remote.getAttribute('style');
    await student.bringToFront();
    await firstArena.locator('canvas').first().click();
    await student.keyboard.down('Shift');
    await student.keyboard.down('w');
    try {
      await student.keyboard.press('Space');
      await new Promise(resolve=>setTimeout(resolve,500));
    } finally {
      await student.keyboard.up('w');
      await student.keyboard.up('Shift');
    }
    await other.bringToFront();
    for (let i=0;i<40 && await remote.getAttribute('style')===before;i++) await new Promise(resolve=>setTimeout(resolve,50));
    assert.notEqual(await remote.getAttribute('style'),before);
    if (process.env.QUIZRUN_SCREENSHOT) await teacher.screenshot({path:process.env.QUIZRUN_SCREENSHOT});

    const member = teacher.getByLabel('보라 토끼 닉네임');
    await member.fill('별 토끼');
    await member.locator('..').getByRole('button',{name:'이름 저장'}).click();
    await other.getByText('별 토끼',{exact:true}).waitFor();
    await student.reload();
    await student.getByText('별 토끼 (나)',{exact:true}).waitFor();
    await teacher.getByLabel('별 토끼 닉네임').waitFor();
    assert.equal(await teacher.locator('#online-roster li').count(),2);

    await teacher.getByRole('button',{name:'별 토끼 내보내기'}).click();
    await teacher.getByRole('dialog').getByRole('button',{name:'확인'}).click();
    await student.getByRole('alert').getByText(/내보냈어요/).waitFor();
    await other.getByText('1 / 30명',{exact:true}).waitFor();
    await other.getByRole('button',{name:'방 나가기'}).click();
    await teacher.getByText('0 / 30명',{exact:true}).waitFor();

    await student.getByLabel('닉네임').fill('별 토끼');
    await student.getByRole('button',{name:'온라인 입장'}).click();
    await teacher.getByText('1 / 30명',{exact:true}).waitFor();
    await teacher.getByRole('button',{name:'방 종료'}).click();
    await teacher.getByRole('dialog').getByRole('button',{name:'확인'}).click();
    await student.getByRole('status').getByText(/이미 종료된 방/).waitFor();
    await student.goto(invite);
    await student.getByLabel('닉네임').fill('다시 입장');
    await student.getByRole('button',{name:'온라인 입장'}).click();
    await student.getByRole('alert').getByText(/이미 종료된 방/).waitFor();

    await teacher.goto(origin+'/#quizzes');
    await teacher.getByRole('button',{name:/직접 만들기/}).waitFor();
    await teacher.goto(origin+'/#solo');
    assert.equal(await teacher.getByLabel('밀기 허용').isChecked(),true);
    assert.equal(await teacher.locator('input[name=bots]').inputValue(),'19');
    await teacher.locator('input[name=bots]').fill('1');
    await teacher.locator('input[name=reveal]').fill('1');
    await teacher.locator('input[name=move]').fill('8');
    await teacher.getByRole('button',{name:/게임 시작/}).click();
    const frame = teacher.frameLocator('iframe[title="퀴즈런 경기장"]');
    await frame.locator('canvas').first().waitFor();
    const push=frame.locator('#push');
    await push.waitFor();
    await teacher.bringToFront();
    await frame.locator('canvas').click({position:{x:40,y:140}});
    await teacher.keyboard.press('f');
    await teacher.keyboard.press('ControlRight');
    assert.ok(await push.isEnabled());
    await teacher.keyboard.down('w');
    await teacher.keyboard.down('Shift');
    try{
      await teacher.keyboard.press('Space');
      await teacher.keyboard.press('ControlLeft');
      await frame.getByText('밀기 3초',{exact:true}).waitFor();
      assert.ok(await push.isDisabled());
    }finally{
      await teacher.keyboard.up('Shift');
      await teacher.keyboard.up('w');
    }
    await student.goto(origin+'/#solo');
    await student.getByLabel('밀기 허용').check();
    await student.locator('input[name=bots]').fill('1');
    await student.locator('input[name=reveal]').fill('1');
    await student.locator('input[name=move]').fill('8');
    await student.getByRole('button',{name:/게임 시작/}).click();
    const touch=student.frameLocator('iframe[title="퀴즈런 경기장"]').locator('#push');
    await student.bringToFront();
    await touch.tap();
    assert.ok(await touch.isDisabled());

    await teacher.getByRole('button',{name:'나가기'}).click();
    await teacher.getByRole('dialog').getByRole('button',{name:'나가기'}).click();
    await teacher.getByRole('heading',{name:'혼자 하기',exact:true}).waitFor();
  } finally {
    await Promise.all(browsers.map(browser=>browser.close()));
    await mf.dispose();
  }
});
