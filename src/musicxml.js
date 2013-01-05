/**
 * VexFlow MusicXML - DOM-based MusicXML backend for VexFlow Documents.
 * @author Daniel Ringwalt (ringw)
 */

if (! Vex.Flow.Backend) Vex.Flow.Backend = {};

/** @constructor */
Vex.Flow.Backend.MusicXML = function() {
  this.partList = new Array();

  // Create timewise array of arrays
  // Measures (zero-indexed) -> array of <measure> elements for each part
  this.measures = new Array();

  // Store number of staves for each part (zero-indexed)
  this.numStaves = new Array();

  // Track every child of any <attributes> element in array
  // (except <staves> which is stored in numStaves)
  // Measures -> parts ->
  //  object where keys are names of child elements ->
  //    data representing the attribute
  this.attributes = new Array();
}

/**
 * Class method.
 * Returns true if the argument appears to be valid MusicXML.
 * Used when automatically detecting MusicXML.
 *
 * @return {Boolean} True if data looks like valid MusicXML.
 */
Vex.Flow.Backend.MusicXML.appearsValid = function(data) {
  if (typeof data == "string") {
    return data.search(/<score-partwise/i) != -1;
  }
  return (data instanceof Document) &&
         (data.documentElement.nodeName == 'score-partwise');
}

/**
 * Parse an XML string, or "parse" an existing DOM Document object.
 * If the parse fails, a Vex.RuntimeError is thrown.
 * Upon success, no exception is thrown and #isValid returns true.
 *
 * @param data The MusicXML data to parse.
 */
Vex.Flow.Backend.MusicXML.prototype.parse = function(data) {
  if (typeof data == "string") {
    // Parse XML string
    if (window.DOMParser && typeof XMLDocument != "undefined") {
      var parser = new window.DOMParser();
      this.document = parser.parseFromString(data, "text/xml");
    }
    else if (window.ActiveXObject
             && new window.ActiveXObject("Microsoft.XMLDOM")) {
      this.document = new window.ActiveXObject("Microsoft.XMLDOM");
      this.document.async = "false";
      this.document.loadXML(data);
    }
    else throw new Vex.RERR("UnsupportedBrowserError", "No XML parser found");
  }
  else if (data instanceof Document) this.document = data;
  else {
    this.valid = false;
    throw new Vex.RERR("ArgumentError",
                       "MusicXML requires XML string or DOM Document object");
  }
  this.documentElement = this.document.documentElement;
  if (this.documentElement.nodeName != 'score-partwise')
    throw new Vex.RERR("ArgumentError",
                       "VexFlow only supports partwise scores");

  // Go through each part, pushing the measures on the correct sub-array
  var partNum = 0;
  for (var i = 0; i < this.documentElement.childNodes.length; i++) {
    var node = this.documentElement.childNodes[i];
    if (node.nodeName == "part") {
      var measureNum = 0;
      for (var j = 0; j < node.childNodes.length; j++) {
        var measure = node.childNodes[j];
        if (measure.nodeName != "measure") continue;
        if (! (j in this.measures)) this.measures[measureNum] = new Array();
        if (this.measures[measureNum].length != partNum) {
          // Some part is missing a measure
          this.valid = false;
          return;
        }
        this.measures[measureNum][partNum] = measure;
        var attributes = measure.getElementsByTagName("attributes")[0];
        if (attributes) this.parseAttributes(measureNum, partNum, attributes);
        measureNum++;
      }
      // numStaves defaults to 1 for this part
      if (! (partNum in this.numStaves))
        this.numStaves[partNum] = 1;
      partNum++;
    }
  }

  this.valid = true;
}

/**
 * Returns true if the passed-in code parsed without errors.
 *
 * @return {Boolean} True if code is error-free.
 */
Vex.Flow.Backend.MusicXML.prototype.isValid = function() { return this.valid; }

/**
 * Number of measures in the document
 *
 * @return {Number} Total number of measures
 */
Vex.Flow.Backend.MusicXML.prototype.getNumberOfMeasures = function() {
  return this.measures.length;
}

/**
 * Create the mth measure from this.measures[m]
 *
 * @return {Vex.Flow.Measure} mth measure as a Measure object
 */
Vex.Flow.Backend.MusicXML.prototype.getMeasure = function(m) {
  var time = {num_beats: 4, beat_value: 4}; // FIXME time signature
  var measure = new Vex.Flow.Measure({time: time});
  var numParts = this.measures[m].length;
  measure.setNumberOfParts(numParts);
  for (var p = 0; p < numParts; p++) {
    var attrs = this.getAttributes(m, p);
    var partOptions = {time: time};
    if (typeof attrs.clef == "string") partOptions.clef = attrs.clef;
    measure.setPart(p, partOptions);
    var part = measure.getPart(p);
    part.setNumberOfStaves(this.numStaves[p]);
    if (attrs.clef instanceof Array)
      for (var s = 0; s < this.numStaves[p]; s++)
        part.setStave(s, {clef: attrs.clef[s]});
    var numVoices = 1; // can expand dynamically
    var noteElems = this.measures[m][p].getElementsByTagName("note");
    var voiceObjects = new Array(); // array of arrays
    for (var i = 0; i < noteElems.length; i++) {
      // FIXME: Chord support
      var noteObj = this.parseNote(noteElems[i], attrs);
      var voiceNum = 0;
      if (noteObj.voice) {
        if (noteObj.voice >=numVoices) part.setNumberOfVoices(noteObj.voice+1);
        voiceNum = noteObj.voice;
        delete noteObj.voice;
      }
      var voice = part.getVoice(voiceNum);
      if (voice.notes.length == 0 && typeof noteObj.stave == "number") {
        // TODO: voice spanning multiple staves (requires VexFlow support)
        voice.stave = noteObj.stave;
      }
      if (noteObj.chord)
        voice.notes[voice.notes.length-1].keys.push(noteObj.keys[0]);
      else voice.addNote(new Vex.Flow.Measure.Note(noteObj));
    }
    // Voices appear to not always be consecutive from 0
    // Copy part and number voices correctly
    // FIXME: Figure out why this happens
    var newPart = new Vex.Flow.Measure.Part(part);
    var v = 0; // Correct voice number
    for (var i = 0; i < part.getNumberOfVoices(); i++)
      if (typeof part.getVoice(i) == "object"
          && part.getVoice(i).notes.length > 0) {
        newPart.setVoice(v, part.getVoice(i));
        v++;
      }
    newPart.setNumberOfVoices(v);
    measure.setPart(p, newPart);
  }
  return measure;
}

Vex.Flow.Backend.MusicXML.prototype.parseAttributes =
  function(measureNum, partNum, attributes) {
  var attrs = attributes.childNodes;
  for (var i = 0; i < attrs.length; i++) {
    var attrObject = null;
    var attr = attrs[i];
    switch (attr.nodeName) {
      case "staves":
        // If this is the first measure, we use <staves>
        if (measureNum == 0)
          this.numStaves[partNum] = parseInt(attr.textContent);
        break;
      case "key":
        attrObject = {
          fifths: parseInt(attr.getElementsByTagName("fifths")[0]
                                   .textContent)
        };
        break;
      case "time":
        attrObject = {
          num_beats: parseInt(attr.getElementsByTagName("beats")[0]
                                      .textContent),
          beat_value: parseInt(attr.getElementsByTagName(
                                          "beat-type")[0].textContent)
        };
        break;
      case "clef":
        var number = parseInt(attr.getAttribute("number"));
        var sign = attr.getElementsByTagName("sign")[0].textContent;
        var line = parseInt(attr.getElementsByTagName("line")[0].textContent);
        var clef = (sign == "G" && line == "2") ? "treble"
                 : (sign == "F" && line == "4") ? "bass"
                 : null;
        if (number > 0) {
          // TODO: fix getAttributes when only one clef changes
          if (measureNum in this.attributes
              && partNum in this.attributes[measureNum]
              && this.attributes[measureNum][partNum].clef instanceof Array)
            attrObject = this.attributes[measureNum][partNum].clef;
          else attrObject = new Array(this.numStaves[partNum]);
          attrObject[number - 1] = clef;
        }
        else attrObject = clef;
        break;
      case "divisions":
        attrObject = parseInt(attr.textContent);
        break;
      default: continue; // Don't use attribute if we don't know what it is
    }
    if (! (measureNum in this.attributes))
      this.attributes[measureNum] = [];
    if (! (partNum in this.attributes[measureNum]))
      this.attributes[measureNum][partNum] = {};
    this.attributes[measureNum][partNum][attr.nodeName] = attrObject;
  }
  return attrObject;
}

Vex.Flow.Backend.MusicXML.prototype.parseNote = function(noteElem, attrs) {
  var num_notes = null, beats_occupied = null;
  var noteObj = {rest: false, chord: false};
  Array.prototype.forEach.call(noteElem.childNodes, function(elem) {
    switch (elem.nodeName) {
      case "pitch":
        var step = elem.getElementsByTagName("step")[0].textContent;
        var octave = parseInt(elem.getElementsByTagName("octave")[0]
                                  .textContent);
        var alter = elem.getElementsByTagName("alter")[0];
        if (alter)
          switch (parseInt(alter.textContent)) {
            case 1: step += "#"; break;
            case 2: step += "##"; break;
            case -1: step += "b"; break;
            case -2: step += "bb"; break;
          }
        noteObj.keys = [step + "/" + octave.toString()];
        break;
      case "type":
        var type = elem.textContent;
        // Look up type
        noteObj.duration = {
          whole: "1", half: "2", quarter: "4", eighth: "8", "16th": "16",
          "32nd": "32", "64th": "64", "128th": "128", "256th": "256"
        }[type];
        if (noteObj.rest) noteObj.duration += "r";
        break;
      case "dot": // Always follow type; noteObj.duration exists
        var duration = noteObj.duration, rest = duration.indexOf("r");
        if (noteObj.rest) duration = duration.substring(0, rest) + "dr";
        else duration += "d";
        noteObj.duration = duration;
        break;
      case "duration":
        var intrinsicTicks = new Vex.Flow.Fraction(Vex.Flow.RESOLUTION / 4
                                                  * parseInt(elem.textContent),
                                                  attrs.divisions).simplify();
        if (isNaN(intrinsicTicks.numerator)
            || isNaN(intrinsicTicks.denominator))
          throw new Vex.RERR("InvalidMusicXML",
                             "Error parsing MusicXML duration");
        if (intrinsicTicks.denominator == 1)
          intrinsicTicks = intrinsicTicks.numerator;
        noteObj.intrinsicTicks = intrinsicTicks;
        // TODO: come up with duration string if we don't have a type
        break;
      case "time-modification":
        num_notes = elem.getElementsByTagName("actual-notes")[0];
        beats_occupied = elem.getElementsByTagName("normal-notes")[0];
        if (num_notes && beats_occupied) {
          num_notes = parseInt(num_notes.textContent);
          beats_occupied = parseInt(beats_occupied.textContent);
        }
        break;
      case "rest":
        noteObj.rest = true;
        var step = elem.getElementsByTagName("display-step")[0];
        var octave = elem.getElementsByTagName("display-octave")[0];
        if (step && octave)
          noteObj.keys = [step.textContent + "/" + octave.textContent];
        break;
      case "chord": noteObj.chord = true; break;
      case "voice":
        var voice = parseInt(elem.textContent);
        if (! isNaN(voice)) noteObj.voice = voice;
        break;
      case "staff":
        var stave = parseInt(elem.textContent);
        if (! isNaN(stave) && stave > 0) noteObj.stave = stave - 1;
        break;
      case "stem":
        if (elem.textContent == "up") noteObj.stem_direction = 1;
        else if (elem.textContent == "down") noteObj.stem_direction = -1;
        break;
      case "beam":
        var beam = elem.textContent;
        Vex.Assert(beam == "begin" || beam == "continue" || beam == "end",
                   "Bad beam in MusicXML: " + beam.toString());
        noteObj.beam = beam;
        break;
      case "notations":
        Array.prototype.forEach.call(elem.childNodes, function(notationElem) {
          switch (notationElem.nodeName) {
            case "tied": // start-continue-stop vs begin-continue-end
              var tie = notationElem.getAttribute("type");
              switch (tie) {
                case "start": noteObj.tie = "begin"; break;
                case "continue": noteObj.tie = "continue"; break;
                case "stop": noteObj.tie = "end"; break;
                default: Vex.RERR("BadMusicXML", "Bad tie: " + tie.toString());
              }
              break;
            // TODO: tuplet
          }
        });
        break;
    }
  });
  if (num_notes && beats_occupied) {
    noteObj.tickMultiplier = new Vex.Flow.Fraction(beats_occupied, num_notes);
    noteObj.tuplet = {num_notes: num_notes, beats_occupied: beats_occupied};
  }
  else {
    noteObj.tickMultiplier = new Vex.Flow.Fraction(1, 1);
    noteObj.tuplet = null;
  }
  // Set default rest position now that we know the stave
  if (noteObj.rest && ! noteObj.keys) {
    var clef = attrs.clef;
    if (clef instanceof Array) clef = clef[noteObj.stave];
    switch (clef) {
      case "bass": noteObj.keys = ["D/3"]; break;
      case "treble": default: noteObj.keys = ["B/4"]; break;
    }
  }
  return noteObj;
}

/**
 * Returns complete attributes object for measure m, part p (zero-indexed)
 */
Vex.Flow.Backend.MusicXML.prototype.getAttributes = function(m, p) {
  var attrs = {};
  // Merge with every previous attributes object in order
  for (var i = 0; i <= m; i++) {
    if (! (i in this.attributes)) continue;
    if (! (p in this.attributes[i])) continue;
    Vex.Merge(attrs, this.attributes[i][p]);
  }
  return attrs;
}

/**
 * Converts keys as fifths (e.g. -2 for Bb) to the equivalent major key ("Bb").
 * @param {Number} number of fifths from -7 to 7
 * @return {String} string representation of key
 */
Vex.Flow.Backend.MusicXML.prototype.fifthsToKey = function(fifths) {
  // Find equivalent key in Vex.Flow.keySignature.keySpecs
  for (var i in Vex.Flow.keySignature.keySpecs) {
    var spec = Vex.Flow.keySignature.keySpecs[i];
    if (typeof spec != "object" || ! ("acc" in spec) || ! ("num" in spec))
      continue;
    if (   (fifths < 0 && spec.acc == "b" && spec.num == Math.abs(fifths))
        || (fifths >= 0 && spec.acc != "b" && spec.num == fifths)) return i;
  }
}