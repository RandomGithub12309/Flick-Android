import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeHtmlEntities,
  findGetMediaUrl,
  parseDurationToSeconds,
  parsePornhubCommentsHtml,
  parsePornhubSearchHtml,
  parsePornhubWatchHtml,
  searchResultToFlickPost,
  selectPornhubVideoSources,
} from "./parse.ts";

test("decodeHtmlEntities and parseDurationToSeconds handle common formats", () => {
  assert.equal(decodeHtmlEntities("Tom &amp; Jerry&#039;s &quot;Clip&quot;"), 'Tom & Jerry\'s "Clip"');
  assert.equal(parseDurationToSeconds("12:34"), 754);
  assert.equal(parseDurationToSeconds("1:02:03"), 3723);
  assert.equal(parseDurationToSeconds("bad"), undefined);
});

test("parsePornhubSearchHtml extracts thumbnails, titles, duration, views, rating, and author", () => {
  const html = `
    <ul>
      <li class="pcVideoListItem" data-video-vkey="65abc123def">
        <div class="phimage">
          <a href="/view_video.php?viewkey=65abc123def" title="First &amp; Best Video">
            <img src="data:image/gif;base64,R0lGODlh" data-mediumthumb="https://ei.phncdn.com/videos/thumb1.jpg" alt="First &amp; Best Video" />
            <var class="duration">14:20</var>
          </a>
        </div>
        <div class="usernameWrap"><a href="/model/creator1">CreatorOne</a></div>
        <span class="views"><var>1.4M</var> views</span>
        <div class="value">94%</div>
      </li>
      <li class="pcVideoListItem" data-video-vkey="65abc123def">
        <a href="/view_video.php?viewkey=65abc123def" title="Duplicate Entry">
          <img data-src="https://ei.phncdn.com/videos/dup.jpg" />
        </a>
      </li>
      <li class="pcVideoListItem" data-video-vkey="66xyz987">
        <a href="/view_video.php?viewkey=66xyz987" title="Second Clip">
          <img data-thumb_url="//di.phncdn.com/videos/thumb2.jpg" />
          <var class="duration">05:10</var>
        </a>
      </li>
    </ul>
  `;

  const items = parsePornhubSearchHtml(html);
  assert.equal(items.length, 2);
  assert.equal(items[0]?.viewkey, "65abc123def");
  assert.equal(items[0]?.title, "First & Best Video");
  assert.equal(items[0]?.thumbnail, "https://ei.phncdn.com/videos/thumb1.jpg");
  assert.equal(items[0]?.duration, "14:20");
  assert.equal(items[0]?.durationSeconds, 860);
  assert.equal(items[0]?.views, "1.4M");
  assert.equal(items[0]?.rating, "94%");
  assert.equal(items[0]?.author, "CreatorOne");
  assert.equal(items[0]?.authorUrl, "https://www.pornhub.com/model/creator1");

  assert.equal(items[1]?.viewkey, "66xyz987");
  assert.equal(items[1]?.thumbnail, "https://di.phncdn.com/videos/thumb2.jpg");

  const post = searchResultToFlickPost(items[0]!);
  assert.equal(post.platform, "pornhub");
  assert.equal(post.pornhubKey, "65abc123def");
  assert.equal(post.authorUrl, "https://www.pornhub.com/model/creator1");
  assert.equal(post.score, 1_400_000);
  assert.equal(post.nsfw, true);
});

test("parsePornhubWatchHtml extracts flashvars, get_media endpoint, ordered sources, and comments", () => {
  const html = `
    <script>
      var flashvars_445566 = {
        "video_title": "Sample &amp; Clip",
        "image_url": "https://ei.phncdn.com/poster.jpg",
        "video_duration": 310,
        "mediaDefinitions": [
          {"format":"hls","quality":"720","videoUrl":"https://cv-h.phncdn.com/master.m3u8"},
          {"format":"mp4","quality":[1080,720,480],"videoUrl":"https://www.pornhub.com/video/get_media?s=abc"}
        ]
      };
    </script>
    <div class="usernameBadgesWrapper"><a href="/model/star">StarChannel</a></div>
    <div class="commentBlock" data-comment-id="9001">
      <a class="usernameLink" href="/users/alice">Alice</a>
      <div class="commentMessage"><span>Great camera work!</span></div>
      <span class="voteTotal">42</span>
    </div>
    <div class="commentBlock" data-comment-id="9002">
      <a class="usernameLink" href="/users/bob">Bob</a>
      <div class="commentMessage"><span>This comment has been deleted.</span></div>
      <span class="voteTotal">0</span>
    </div>
  `;

  const parsed = parsePornhubWatchHtml(html, "65abc123def");
  assert.equal(parsed.videoId, "445566");
  assert.equal(parsed.title, "Sample & Clip");
  assert.equal(parsed.author, "StarChannel");
  assert.equal(parsed.durationSeconds, 310);
  assert.equal(
    findGetMediaUrl(parsed.mediaDefinitions),
    "https://www.pornhub.com/video/get_media?s=abc",
  );

  const sources = selectPornhubVideoSources(parsed.mediaDefinitions, [
    { format: "mp4", quality: "480", videoUrl: "https://ev-h.phncdn.com/480.mp4" },
    { format: "mp4", quality: "1080", videoUrl: "https://ev-h.phncdn.com/1080.mp4" },
    { format: "mp4", quality: "720", videoUrl: "https://ev-h.phncdn.com/720.mp4" },
  ]);
  assert.ok(sources);
  assert.equal(sources.url, "https://ev-h.phncdn.com/1080.mp4");
  assert.equal(sources.fallbackUrl, "https://ev-h.phncdn.com/720.mp4");
  assert.deepEqual(sources.fallbackUrls, [
    "https://ev-h.phncdn.com/720.mp4",
    "https://ev-h.phncdn.com/480.mp4",
    "https://cv-h.phncdn.com/master.m3u8",
  ]);

  assert.equal(parsed.comments.length, 1);
  assert.equal(parsed.comments[0]?.author, "Alice");
  assert.equal(parsed.comments[0]?.body, "Great camera work!");
  assert.equal(parsed.comments[0]?.score, 42);
});

test("parsePornhubCommentsHtml parses standalone comment fragments", () => {
  const frag = `
    <div class="commentBlock" id="cmt_77">
      <div class="usernameWrap"><a href="/users/dave">Dave</a></div>
      <div class="commentMessage">Line 1<br/>Line 2</div>
      <span class="voteTotal">-3</span>
    </div>
  `;
  const comments = parsePornhubCommentsHtml(frag);
  assert.equal(comments.length, 1);
  assert.equal(comments[0]?.id, "77");
  assert.equal(comments[0]?.author, "Dave");
  assert.equal(comments[0]?.body, "Line 1\nLine 2");
  assert.equal(comments[0]?.score, -3);
});
