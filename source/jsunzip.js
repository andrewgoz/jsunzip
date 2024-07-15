/*
 * JSUnzip
 *
 * Copyright (c) 2011 by Erik Moller
 * All Rights Reserved
 *
 * This software is provided 'as-is', without any express
 * or implied warranty.  In no event will the authors be
 * held liable for any damages arising from the use of
 * this software.
 *
 * Permission is granted to anyone to use this software
 * for any purpose, including commercial applications,
 * and to alter it and redistribute it freely, subject to
 * the following restrictions:
 *
 * 1. The origin of this software must not be
 *    misrepresented; you must not claim that you
 *    wrote the original software. If you use this
 *    software in a product, an acknowledgment in
 *    the product documentation would be appreciated
 *    but is not required.
 *
 * 2. Altered source versions must be plainly marked
 *    as such, and must not be misrepresented as
 *    being the original software.
 *
 * 3. This notice may not be removed or altered from
 *    any source distribution.
 */
 
var tinf;

function JSUnzip() {
    "use strict";
    var data;
    var files;
    var comment;
    function getInt(offset, size) {
        switch (size) {
        case 4:
            return data[offset + 3] << 24 | 
                   data[offset + 2] << 16 | 
                   data[offset + 1] << 8 | 
                   data[offset + 0];
        case 2:
            return data[offset + 1] << 8 | 
                   data[offset + 0];
        default:
            return data[offset];
        }
    }

    function getDOSDate(dosdate, dostime) {
        var day = dosdate & 0x1f;
        var month = ((dosdate >>> 5) & 0xf) - 1;
        var year = 1980 + ((dosdate >>> 9) & 0x7f);
        var second = (dostime & 0x1f) * 2;
        var minute = (dostime >>> 5) & 0x3f;
        var hour = (dostime >>> 11) & 0x1f;
        return new Date(year, month, day, hour, minute, second);
    }

    function stringOf(array) {
        var str = '';
        for (var i = 0; i < array.length; ++i) {
            str += String.fromCharCode(array[i]);
        }
        return str;
    }

    var crc32 = (function() {
        let table = new Uint32Array(256);
        for (let i = 256; i--;) {
            let t = i;
            for (let k = 8; k--;) {
                t = t & 1 ? 3988292384 ^ t >>> 1 : t >>> 1;
            }
            table[i] = t;
        }
        return function(data) {
            let crc = -1;
            for (let i = 0, l = data.length; i < l; i++) {
                crc = crc >>> 8 ^ table[crc & 255 ^ data[i]];
            }
            return (crc ^ -1) >>> 0;
        };
    })();

    function open(_data) {
        var i;
        // Convert data to a Uint8Array only if it's a string.  For the fastest decode,
        // supply a Uint8Array already. On most browsers this can be achieved in XHR with:
        // request.responseType = "arraybuffer";
        // and then passing the "request.response" object here (NOT request.responseText).
        if (typeof(_data) == "string") {
            data = new Uint8Array(_data.length);
            for (i = 0; i < _data.length; ++i) data[i] = _data.charCodeAt(i) & 0xff;
        } else {
            data = _data;
        }
        files = [];

        if (data.length < 22)
            return { 'status' : false, 'error' : 'Invalid data' };
        var endOfCentralDirectory = data.length - 22;
        while (endOfCentralDirectory >= 0 && getInt(endOfCentralDirectory, 4) != 0x06054b50)
            --endOfCentralDirectory;
        if (endOfCentralDirectory < 0)
            return { 'status' : false, 'error' : 'Invalid data' };
        if (getInt(endOfCentralDirectory + 4, 2) !== 0 || getInt(endOfCentralDirectory + 6, 2) !== 0)
            return { 'status' : false, 'error' : 'No multidisk support' };

        var entriesInThisDisk = getInt(endOfCentralDirectory + 8, 2);
        var centralDirectoryOffset = getInt(endOfCentralDirectory + 16, 4);
        var globalCommentLength = getInt(endOfCentralDirectory + 20, 2);
        comment = stringOf(data.subarray(endOfCentralDirectory + 22, endOfCentralDirectory + 22 + globalCommentLength));

        var fileOffset = centralDirectoryOffset;

        for (i = 0; i < entriesInThisDisk; ++i) {
            if (getInt(fileOffset + 0, 4) != 0x02014b50)
                return { 'status' : false, 'error' : 'Invalid data' };
            if (getInt(fileOffset + 6, 2) > 20)
                return { 'status' : false, 'error' : 'Unsupported version' };
            if (getInt(fileOffset + 8, 2) & 1)
                return { 'status' : false, 'error' : 'Encryption not implemented' };

            var compressionMethod = getInt(fileOffset + 10, 2);
            if (compressionMethod !== 0 && compressionMethod !== 8)
                return { 'status' : false, 'error' : 'Unsupported compression method' };

            var lastModFileTime = getInt(fileOffset + 12, 2);
            var lastModFileDate = getInt(fileOffset + 14, 2);
            var lastModifiedDate = getDOSDate(lastModFileDate, lastModFileTime);

            var crc = getInt(fileOffset + 16, 4) >>> 0;

            var compressedSize = getInt(fileOffset + 20, 4);
            var uncompressedSize = getInt(fileOffset + 24, 4);

            var fileNameLength = getInt(fileOffset + 28, 2);
            var extraFieldLength = getInt(fileOffset + 30, 2);
            var fileCommentLength = getInt(fileOffset + 32, 2);

            var relativeOffsetOfLocalHeader = getInt(fileOffset + 42, 4);

            var fileName = stringOf(data.subarray(
                fileOffset + 46,
                fileOffset + 46 + fileNameLength));
            var fileComment = stringOf(data.subarray(
                fileOffset + 46 + fileNameLength + extraFieldLength,
                fileOffset + 46 + fileNameLength + extraFieldLength + fileCommentLength));

            if (getInt(relativeOffsetOfLocalHeader + 0, 4) != 0x04034b50)
                return { 'status' : false, 'error' : 'Invalid data' };
            var localFileNameLength = getInt(relativeOffsetOfLocalHeader + 26, 2);
            var localExtraFieldLength = getInt(relativeOffsetOfLocalHeader + 28, 2);
            var localFileContent = relativeOffsetOfLocalHeader + 30 + localFileNameLength + localExtraFieldLength;

            files[fileName] = 
            {
                'fileComment'      : fileComment,
                'compressionMethod': compressionMethod,
                'compressedSize'   : compressedSize,
                'uncompressedSize' : uncompressedSize,
                'crc'              : crc,
                'localFileContent' : localFileContent,
                'lastModifiedDate' : lastModifiedDate
            };

            fileOffset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
        }
        return { 'status' : true };
    }
    
    // Reads the data and returns a Uint8Array of the results. This is the fastest method.
    // To read the data as a string, use read()
    function readBinary(fileName) {
        var result, fileInfo = files[fileName];
        if (fileInfo) {
            if (fileInfo.compressionMethod == 8) {
                if (!tinf) {
                    tinf = TINF();
                }
                result = tinf.uncompress(data, fileInfo.localFileContent, fileInfo.uncompressedSize);
            } else {
                result = { status: tinf.OK, data: data.subarray(fileInfo.localFileContent, fileInfo.localFileContent + fileInfo.uncompressedSize) };
            }
            if ((result.status == tinf.OK) && (fileInfo.crc != crc32(result.data))) {
                result.status = tinf.DATA_ERROR;
                result.error = 'CRC mismatch';
            }
            if (result.status == tinf.OK)
                return { 'status' : true, 'data' : result.data };
            else
                return { 'status' : false, 'error' : result.error };
        }
        return { 'status' : false, 'error' : "File '" + fileName + "' doesn't exist in zip" };
    }

    function read(fileName) {
        var result = readBinary(fileName);
        if (result.data) {
            result.data = stringOf(result.data);
        }
        return result;
    }
    return {
        files:()=>files,
        comment:()=>comment,
        stringOf:stringOf,
        open:open,
        readBinary:readBinary,
        read:read
    };
}



/*
 * tinflate  -  tiny inflate
 *
 * Copyright (c) 2003 by Joergen Ibsen / Jibz
 * All Rights Reserved
 *
 * http://www.ibsensoftware.com/
 *
 * This software is provided 'as-is', without any express
 * or implied warranty.  In no event will the authors be
 * held liable for any damages arising from the use of
 * this software.
 *
 * Permission is granted to anyone to use this software
 * for any purpose, including commercial applications,
 * and to alter it and redistribute it freely, subject to
 * the following restrictions:
 *
 * 1. The origin of this software must not be
 *    misrepresented; you must not claim that you
 *    wrote the original software. If you use this
 *    software in a product, an acknowledgment in
 *    the product documentation would be appreciated
 *    but is not required.
 *
 * 2. Altered source versions must be plainly marked
 *    as such, and must not be misrepresented as
 *    being the original software.
 *
 * 3. This notice may not be removed or altered from
 *    any source distribution.
 */

/*
 * tinflate javascript port by Erik Moller in May 2011.
 * emoller@opera.com
 */

function TINF() {
"use strict";

const OK = 0;
const DATA_ERROR = (-3);

/* ------------------------------ *
 * -- internal data structures -- *
 * ------------------------------ */

function TREE() {
    var table = new Array(16);  /* table of code length counts */
    var trans = new Array(288); /* code -> symbol translation table */
    return {t:table,x:trans};
}

/* --------------------------------------------------- *
 * -- uninitialized global data (static structures) -- *
 * --------------------------------------------------- */

var sltree = TREE(); /* fixed length/symbol tree */
var sdtree = TREE(); /* fixed distance tree */

/* extra bits and base tables for length codes */
var length_bits = new Array(30);
var length_base = new Array(30);

/* extra bits and base tables for distance codes */
var dist_bits = new Array(30);
var dist_base = new Array(30);

/* special ordering of code length codes */
var clcidx = [
    16, 17, 18, 0, 8, 7, 9, 6,
    10, 5, 11, 4, 12, 3, 13, 2,
    14, 1, 15
];

/* ----------------------- *
 * -- utility functions -- *
 * ----------------------- */

/* build extra bits and base tables */
function build_bits_base(bits, base, delta, first)
{
    var i, sum;

    /* build bits table */
    for (i = 0; i < delta; ++i) bits[i] = 0;
    for (i = 0; i < 30 - delta; ++i) bits[i + delta] = Math.floor(i / delta);

    /* build base table */
    for (sum = first, i = 0; i < 30; ++i)
    {
        base[i] = sum;
        sum += 1 << bits[i];
    }
}

/* build the fixed huffman trees */
function build_fixed_trees(lt, dt)
{
    var i;

    /* build fixed length tree */
    for (i = 0; i < 7; ++i) lt.t[i] = 0;

    lt.t[7] = 24;
    lt.t[8] = 152;
    lt.t[9] = 112;

    for (i = 0; i < 24; ++i) lt.x[i] = 256 + i;
    for (i = 0; i < 144; ++i) lt.x[24 + i] = i;
    for (i = 0; i < 8; ++i) lt.x[24 + 144 + i] = 280 + i;
    for (i = 0; i < 112; ++i) lt.x[24 + 144 + 8 + i] = 144 + i;

    /* build fixed distance tree */
    for (i = 0; i < 5; ++i) dt.t[i] = 0;

    dt.t[5] = 32;

    for (i = 0; i < 32; ++i) dt.x[i] = i;
}

/* given an array of code lengths, build a tree */
function build_tree(t, lengths, loffset, num)
{
    var offs = new Array(16);
    var i, sum;

    /* clear code length count table */
    for (i = 0; i < 16; ++i) t.t[i] = 0;

    /* scan symbol lengths, and sum code length counts */
    for (i = 0; i < num; ++i) t.t[lengths[loffset + i]]++;

    t.t[0] = 0;

    /* compute offset table for distribution sort */
    for (sum = 0, i = 0; i < 16; ++i)
    {
        offs[i] = sum;
        sum += t.t[i];
    }

    /* create code->symbol translation table (symbols sorted by code) */
    for (i = 0; i < num; ++i)
    {
        if (lengths[loffset + i]) t.x[offs[lengths[loffset + i]]++] = i;
    }
}

/* ---------------------- *
 * -- decode functions -- *
 * ---------------------- */

/* read a num bit value from a stream */
function read_bits(d, num)
{
    var val = 0;
    if (num) {
        while (d.bc < num) {
            d.t = d.t | d.s[d.si++] << d.bc;
            d.bc += 8;
        }
        val = d.t & (0xffff >>> (16 - num));
        d.t >>>= num;
        d.bc -= num;
    }
    return val;
}

/* given a data stream and a tree, decode a symbol */
function decode_symbol(d, t)
{
    while (d.bc < 24) {
        d.t = d.t | d.s[d.si++] << d.bc;
        d.bc += 8;
    }
    
    var sum = 0, cur = 0, len = 0;
    do {
        cur = 2 * cur + ((d.t & (1 << len)) >>> len);

        ++len;

        sum += t.t[len];
        cur -= t.t[len];

    } while (cur >= 0);

    d.t >>>= len;
    d.bc -= len;

    return t.x[sum + cur];
}

/* given a data stream, decode dynamic trees from it */
function decode_trees(d, lt, dt)
{
    var code_tree = TREE();
    var lengths = new Array(288 + 32);
    var hlit, hdist, hclen;
    var i, num, length;

    /* get 5 bits HLIT (257-286) */
    hlit = read_bits(d, 5) + 257;

    /* get 5 bits HDIST (1-32) */
    hdist = read_bits(d, 5) + 1;

    /* get 4 bits HCLEN (4-19) */
    hclen = read_bits(d, 4) + 4;

    for (i = 0; i < 19; ++i) lengths[i] = 0;

    /* read code lengths for code length alphabet */
    for (i = 0; i < hclen; ++i)
    {
        /* get 3 bits code length (0-7) */
        lengths[clcidx[i]] = read_bits(d, 3);
    }

    /* build code length tree */
    build_tree(code_tree, lengths, 0, 19);

    /* decode code lengths for the dynamic trees */
    for (num = 0; num < hlit + hdist; )
    {
        var sym = decode_symbol(d, code_tree);
        switch (sym)
        {
        case 16:
            /* copy previous code length 3-6 times (read 2 bits) */
            sym = lengths[num - 1];
            length = read_bits(d, 2) + 3;
            break;
        case 17:
            /* repeat code length 0 for 3-10 times (read 3 bits) */
            sym = 0;
            length = read_bits(d, 3) + 3;
            break;
        case 18:
            /* repeat code length 0 for 11-138 times (read 7 bits) */
            sym = 0;
            length = read_bits(d, 7) + 11;
            break;
        default:
            /* values 0-15 represent the actual code lengths */
            length = 1;
            break;
        }
        while (length--)
        {
           lengths[num++] = sym;
        }
    }

    /* build dynamic trees */
    build_tree(lt, lengths, 0, hlit);
    build_tree(dt, lengths, hlit, hdist);
}

/* ----------------------------- *
 * -- block inflate functions -- *
 * ----------------------------- */

/* given a stream and two trees, inflate a block of data */
function inflate_block_data(d, lt, dt)
{
    // js optimization.
    var ddest = d.d;
    var ddestlength = d.di;

    for (;;)
    {
        var sym = decode_symbol(d, lt);

        /* check for end of block */
        if (sym == 256)
        {
           d.di = ddestlength;
           return OK;
        }

        if (sym < 256)
        {
            ddest[ddestlength++] = sym;
        } else {

            var length, dist, offs;
            var i;

            sym -= 257;

            /* possibly get more bits from length code */
            length = read_bits(d, length_bits[sym]) + length_base[sym];

            dist = decode_symbol(d, dt);

            /* possibly get more bits from distance code */
            offs = ddestlength - (read_bits(d, dist_bits[dist]) + dist_base[dist]);

            /* copy match */
            for (i = offs; i < offs + length; ++i) {
                ddest[ddestlength++] = ddest[i];
            }
        }
    }
}

/* inflate an uncompressed block of data */
function inflate_uncompressed_block(d)
{
    var length, invlength;
    var i;

    /* get length */
    length = d.s[d.si+1];
    length = 256 * length + d.s[d.si];

    /* get one's complement of length */
    invlength = d.s[d.si + 3];
    invlength = 256 * invlength + d.s[d.si + 2];

    /* check length */
    if (length != (~invlength & 0x0000ffff)) return DATA_ERROR;

    d.si += 4;

    /* copy block */
    for (i = length; i; --i)
        d.d[d.di] = d.s[d.si++];

    /* make sure we start next block on a byte boundary */
    d.bc = 0;

    return OK;
}

/* ---------------------- *
 * -- public functions -- *
 * ---------------------- */

/* initialize global (static) data */
function init()
{
    /* build fixed huffman trees */
    build_fixed_trees(sltree, sdtree);

    /* build extra bits and base tables */
    build_bits_base(length_bits, length_base, 4, 3);
    build_bits_base(dist_bits, dist_base, 2, 1);

    /* fix a special case */
    length_bits[28] = 0;
    length_base[28] = 258;
}

/* inflate stream from source to dest */
function uncompress(source, offset, uncompressedSize)
{
    var d = {
        s:source,   /* source */
        si:offset,  /* sourceIndex */
        t:0,        /* tag */
        bc:0,       /* bitcount */
        d:new Uint8Array(uncompressedSize), /* dest */
        di:0,       /* destIndex */
        lt: TREE(), /* ltree - dynamic length/symbol tree */
        dt: TREE()  /* dtree - dynamic distance tree */
    };
    var bfinal;

    do {

        var btype;
        var res;

        /* read final block flag */
        bfinal = read_bits(d, 1);

        /* read block type (2 bits) */
        btype = read_bits(d, 2);

        /* decompress block */
        switch (btype)
        {
        case 0:
            /* decompress uncompressed block */
            res = inflate_uncompressed_block(d);
            break;
        case 1:
            /* decompress block with fixed huffman trees */
            /* decode block using fixed trees */
            res = inflate_block_data(d, sltree, sdtree);
            break;
        case 2:
            /* decompress block with dynamic huffman trees */
            /* decode trees from stream */
            decode_trees(d, d.lt, d.dt);
            /* decode block using decoded trees */
            res = inflate_block_data(d, d.lt, d.dt);
            break;
        default:
            res = DATA_ERROR;
        }

        if (res != OK) return { status: res };

    } while (!bfinal);

    return { status: OK, data: d.d };
}

init();
return {
    OK:OK,
    DATA_ERROR:DATA_ERROR,
    uncompress:uncompress
};

}
