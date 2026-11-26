/* Browser-only XLSX I/O. JSZip handles the ZIP container; the worksheet values use OOXML. */
const QuizWorkbook=(()=>{
  const mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const xmlHead='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const spreadsheetNS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const relationNS='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const packageNS='http://schemas.openxmlformats.org/package/2006/relationships';
  const blank=value=>String(value??'').trim()==='';
  const xml=value=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'\ufffd').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
  const all=(node,name)=>Array.from(node.getElementsByTagNameNS('*',name));
  const first=(node,name)=>all(node,name)[0];
  const richText=node=>all(node,'t').filter(t=>t.parentElement?.localName!=='rPh').map(t=>t.textContent).join('');
  async function read(bytes,zip=JSZip,Parser=DOMParser){
    let archive;
    try{archive=await zip.loadAsync(bytes);}catch{throw Error('엑셀 .xlsx 파일을 열 수 없습니다. 엑셀에서 .xlsx로 다시 저장해 주세요.');}
    async function documentAt(path,optional=false){
      const file=archive.file(path);
      if(!file){if(optional)return null;throw Error('엑셀 파일에서 문제 시트를 찾을 수 없습니다.');}
      const doc=new Parser().parseFromString(await file.async('string'),'application/xml');
      if(first(doc,'parsererror')||doc.doctype)throw Error('엑셀 문서 형식을 읽을 수 없습니다.');
      return doc;
    }
    const workbook=await documentAt('xl/workbook.xml');
    const relations=await documentAt('xl/_rels/workbook.xml.rels');
    const sheets=all(workbook,'sheet');
    const sheet=sheets.find(s=>s.getAttribute('name')==='문제')||sheets[0];
    const id=sheet?.getAttributeNS(relationNS,'id')||sheet?.getAttribute('r:id');
    const rel=all(relations,'Relationship').find(r=>r.getAttribute('Id')===id);
    if(!rel||rel.getAttribute('TargetMode')==='External'||!(rel.getAttribute('Type')||'').endsWith('/worksheet'))throw Error('엑셀 파일에 읽을 수 있는 문제 시트가 없습니다.');
    const target=rel.getAttribute('Target');
    const path=new URL(target,'https://workbook.invalid/xl/workbook.xml').pathname.slice(1);
    const doc=await documentAt(path);
    const strings=await documentAt('xl/sharedStrings.xml',true);
    const shared=strings?all(strings,'si').map(richText):[];
    const rows=[];
    let previous=0;
    for(const row of all(doc,'row')){
      const number=Number(row.getAttribute('r'))||previous+1;
      previous=number;
      const cells=[];
      let column=0;
      for(const cell of all(row,'c')){
        const address=/^([A-Z]+)\d+$/.exec(cell.getAttribute('r')||'');
        if(address)column=[...address[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;
        const kind=cell.getAttribute('t'), raw=first(cell,'v')?.textContent??'';
        if(kind==='e')throw Error(`엑셀 ${number}행 · 셀 오류를 수정하고 다시 불러와 주세요.`);
        if(first(cell,'f')&&blank(raw))throw Error(`엑셀 ${number}행 · 계산되지 않은 수식이 있습니다. 값을 입력해 주세요.`);
        if(kind==='s'&&(!/^\d+$/.test(raw)||shared[Number(raw)]===undefined))throw Error(`엑셀 ${number}행 · 텍스트 셀을 해석할 수 없습니다.`);
        const value=kind==='s'?shared[Number(raw)]:kind==='inlineStr'?richText(cell):kind==='b'?(raw==='1'?'TRUE':'FALSE'):raw;
        if(!blank(value))cells[column]=value;
        column++;
      }
      if(cells.some(v=>!blank(v)))rows.push({number,cells});
      if(rows.length>1001)throw Error('엑셀에 문제가 50개를 초과합니다. 파일에서 문제 수를 줄여 주세요.');
    }
    if(rows[0]?.number!==1)throw Error('첫 행에 열 이름을 입력해 주세요.');
    return rows;
  }
  function worksheet(rows,widths){
    const columns=widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('');
    const data=rows.map((row,r)=>`<row r="${r+1}">${row.map((v,c)=>{
      const addr=String.fromCharCode(65+c)+(r+1);
      return typeof v==='number'?`<c r="${addr}"><v>${v}</v></c>`:`<c r="${addr}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    return `${xmlHead}<worksheet xmlns="${spreadsheetNS}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columns}</cols><sheetData>${data}</sheetData></worksheet>`;
  }
  async function write(questions,Zip=JSZip,type='blob'){
    const zip=new Zip();
    zip.file('[Content_Types].xml',`${xmlHead}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
    zip.file('_rels/.rels',`${xmlHead}<Relationships xmlns="${packageNS}"><Relationship Id="rId1" Type="${relationNS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    zip.file('xl/workbook.xml',`${xmlHead}<workbook xmlns="${spreadsheetNS}" xmlns:r="${relationNS}"><sheets><sheet name="문제" sheetId="1" r:id="rId1"/><sheet name="작성 방법" sheetId="2" r:id="rId2"/></sheets></workbook>`);
    zip.file('xl/_rels/workbook.xml.rels',`${xmlHead}<Relationships xmlns="${packageNS}"><Relationship Id="rId1" Type="${relationNS}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${relationNS}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`);
    zip.file('xl/worksheets/sheet1.xml',worksheet([QuizData.headers,...questions.map(([question,options,correct,explanation])=>[question,...options,correct+1,explanation])],[42,23,23,23,23,14,50]));
    zip.file('xl/worksheets/sheet2.xml',worksheet([['퀴즈런 엑셀 작성 방법'],['1. 문제 시트 첫 행의 열 제목을 그대로 두세요.'],['2. 한 행에 한 문제와 선택지 4개를 입력하세요. 선택지는 서로 달라야 합니다.'],['3. 정답 번호는 1~4입니다. 해설은 비워도 됩니다.'],['4. 빈 행은 자동으로 제외되며 퀴즈 한 개는 최대 50문제입니다.'],['5. 퀴즈 관리에서 .xlsx 파일을 불러오고 문제를 확인한 뒤 저장하세요.']],[100]));
    return zip.generateAsync({type,mimeType:mime,compression:'DEFLATE'});
  }
  return {read,write};
})();
if(typeof module!=='undefined')module.exports=QuizWorkbook;
